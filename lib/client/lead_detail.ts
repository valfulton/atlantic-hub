/**
 * lib/client/lead_detail.ts
 *
 * One client-owned lead, in full, for the client portal's lead-DETAIL page
 * (/client/leads/[audit_id]). Scoped strictly to the client's account the same
 * way lib/client/leads.ts is: we match audit_id AND client_id = ? exactly, never
 * client_id IS NULL (the operator's own pipeline). A lead the client does not own
 * returns null -> the page 404s.
 *
 * CLIENT-SAFE BY DESIGN (what we deliberately DO and DON'T expose):
 *   - DO: company/contact, the audit (their seller-lens call brief), the Living
 *     Score + band + breakdown, the "what to say on the call" script.
 *   - DON'T: the AI model/version or any "scored by GPT" mechanism (clients see
 *     the result, not the machinery — see feedback_ai_verbiage), lead sourcing
 *     internals, or the self-reported intake "challenge" (empty for client-found
 *     prospects; the operator-only Challenge tab is omitted on the client side).
 *
 * Read-only. Called from a client portal server component that middleware has
 * already authenticated as a client_user.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export type LeadBand = 'hot' | 'warm' | 'cool' | null;

export interface ClientScoreBreakdown {
  fit: number | null;
  intent: number | null;
  reachability: number | null;
  icp_match: number | null;
}

export interface ClientCallScript {
  primaryPain: string | null;
  urgency: string | null;
  openers: string[];
  avoid: string[];
}

export interface ClientLeadDetail {
  id: number;
  auditId: string | null;
  company: string;
  industry: string | null;
  contactName: string | null;
  contactTitle: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  leadStatus: string;
  /** Visible Living Score: combined when present, else fit-only. */
  score: number | null;
  band: LeadBand;
  /** The engagement half of the Living Score (how the lead is warming). */
  engagementScore: number | null;
  /** Sub-scores for the breakdown chart. No model/version is ever included. */
  breakdown: ClientScoreBreakdown | null;
  /** Plain-language reason for the score (no mechanism/jargon). */
  scoreReason: string | null;
  auditContent: string | null;
  auditGenerated: string | null;
  painSummary: string | null;
  callScript: ClientCallScript | null;
  submittedAt: string | null;
}

interface DetailRow extends RowDataPacket {
  id: number;
  audit_id: string | null;
  company: string | null;
  industry: string | null;
  contact_name: string | null;
  contact_title: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  lead_status: string | null;
  ai_score: number | null;
  ai_combined_score: number | null;
  ai_engagement_score: number | null;
  ai_score_band: LeadBand;
  ai_score_reason: string | null;
  ai_score_breakdown: string | object | null;
  audit_content: string | null;
  audit_generated: string | Date | null;
  pain_point_profile: string | object | null;
  submission_date: string | Date | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hide the apollo/clay/no-email placeholders the discovery providers mint. */
function realEmail(e: string | null): string | null {
  if (!e || !e.trim()) return null;
  const v = e.trim();
  if (/^(prospect|apollo|noemail)\+/i.test(v)) return null;
  if (/^info@eventsbywater\.com$/i.test(v)) return null;
  return v;
}

function asObj(raw: string | object | null): Record<string, unknown> | null {
  if (raw == null) return null;
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function breakdownOf(raw: string | object | null): ClientScoreBreakdown | null {
  const o = asObj(raw);
  if (!o) return null;
  const b: ClientScoreBreakdown = {
    fit: numOrNull(o.fit),
    intent: numOrNull(o.intent),
    reachability: numOrNull(o.reachability),
    icp_match: numOrNull(o.icp_match)
  };
  if (b.fit == null && b.intent == null && b.reachability == null && b.icp_match == null) return null;
  return b;
}

function painSummaryOf(raw: string | object | null): string | null {
  const o = asObj(raw);
  if (!o) return null;
  const s = o.summary ?? o.headline ?? o.primary_pain ?? o.primary;
  if (typeof s === 'string' && s.trim()) return s.trim();
  return null;
}

function callScriptOf(raw: string | object | null): ClientCallScript | null {
  const o = asObj(raw);
  if (!o) return null;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  const openers = strArr(o.conversation_starters ?? o.openers);
  const avoid = strArr(o.do_not_say ?? o.avoid);
  const primaryPain = typeof o.primary_pain === 'string' && o.primary_pain.trim() ? o.primary_pain.trim() : null;
  const urgency = typeof o.urgency_signal === 'string' && o.urgency_signal.trim() ? o.urgency_signal.trim() : null;
  if (!openers.length && !avoid.length && !primaryPain) return null;
  return { primaryPain, urgency, openers, avoid };
}

function toIso(v: string | Date | null): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * One lead the client owns, by audit_id. Returns null if the audit_id is invalid,
 * the lead doesn't exist, is archived, or is NOT owned by this client_id.
 */
export async function getClientLeadDetail(
  clientId: number | null,
  auditId: string
): Promise<ClientLeadDetail | null> {
  const cid = Number(clientId);
  if (!Number.isInteger(cid) || cid <= 0) return null;
  if (!auditId || !UUID_RE.test(auditId)) return null;

  const db = getAvDb();
  const [rows] = await db.execute<DetailRow[]>(
    `SELECT id, audit_id, company, industry, contact_name, contact_title, email, phone, website,
            lead_status, ai_score, ai_combined_score, ai_engagement_score, ai_score_band,
            ai_score_reason, ai_score_breakdown, audit_content, audit_generated,
            pain_point_profile, submission_date
       FROM leads
      WHERE archived_at IS NULL
        AND audit_id = ?
        AND client_id = ?
      LIMIT 1`,
    [auditId, cid]
  );
  const r = rows[0];
  if (!r) return null;

  return {
    id: r.id,
    auditId: r.audit_id,
    company: r.company || 'Untitled lead',
    industry: r.industry,
    contactName: r.contact_name && !r.contact_name.trim().startsWith('(') ? r.contact_name : null,
    contactTitle: r.contact_title && r.contact_title.trim() ? r.contact_title : null,
    email: realEmail(r.email),
    phone: r.phone && r.phone.trim() ? r.phone : null,
    website: r.website && r.website.trim() ? r.website : null,
    leadStatus: r.lead_status || 'new',
    score:
      r.ai_combined_score !== null
        ? Number(r.ai_combined_score)
        : r.ai_score !== null
          ? Number(r.ai_score)
          : null,
    band: r.ai_score_band,
    engagementScore: r.ai_engagement_score == null ? null : Number(r.ai_engagement_score),
    breakdown: breakdownOf(r.ai_score_breakdown),
    scoreReason: r.ai_score_reason && r.ai_score_reason.trim() ? r.ai_score_reason.trim() : null,
    auditContent: r.audit_content,
    auditGenerated: toIso(r.audit_generated),
    painSummary: painSummaryOf(r.pain_point_profile),
    callScript: callScriptOf(r.pain_point_profile),
    submittedAt: toIso(r.submission_date)
  };
}
