/**
 * lib/client/leads.ts
 *
 * The client portal's "Your Leads" feed: the prospects the platform has
 * discovered / imported FOR a specific paying client, scoped strictly to
 * THAT client's account.
 *
 * SCOPING / SAFETY (read this before touching the WHERE clause):
 *   Leads are owned by a client via leads.client_id -> clients.client_id.
 *   `client_id IS NULL` means "the operator's (Val's) own pipeline" -- the
 *   entire prospecting book. A client must NEVER see those. Therefore:
 *     - we require a positive integer client_id, and
 *     - we match leads.client_id = ? exactly (never IS NULL).
 *   If the caller has no client_id yet (a brand-new intake account that has
 *   not been provisioned to a clients row), we return an empty list -- the
 *   page shows a "workspace being set up" state, never operator data.
 *
 * We also deliberately DO NOT expose lead-sourcing internals (source_type,
 * target_business, enrichment provider status, the apollo/clay placeholder
 * emails). Where the leads came from is operator-only. Clients see results.
 *
 * Read-only. Called from client portal server components that middleware has
 * already authenticated as a client_user.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export type LeadBand = 'hot' | 'warm' | 'cool' | null;

export interface ClientLead {
  id: number;
  auditId: string | null;
  company: string;
  industry: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  leadStatus: string;
  /** The visible Living Score: combined when present, else fit-only. */
  score: number | null;
  band: LeadBand;
  /** A short, human pain summary if one has been extracted; else null. */
  painSummary: string | null;
  submittedAt: string | null;
}

interface LeadRow extends RowDataPacket {
  id: number;
  audit_id: string | null;
  company: string | null;
  industry: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  lead_status: string | null;
  ai_score: number | null;
  ai_combined_score: number | null;
  ai_score_band: LeadBand;
  pain_point_profile: string | object | null;
  submission_date: string | Date | null;
}

/**
 * Real prospect emails only -- hide the apollo/clay/no-email placeholders the
 * discovery providers mint. Clients should never see scaffolding addresses.
 */
function realEmail(e: string | null): string | null {
  if (!e || !e.trim()) return null;
  const v = e.trim();
  if (/^(prospect|apollo|noemail)\+.*@eventsbywater\.com$/i.test(v)) return null;
  if (/^info@eventsbywater\.com$/i.test(v)) return null;
  return v;
}

/** Best-effort short pain summary from the extracted profile JSON. */
function painSummaryOf(raw: string | object | null): string | null {
  if (raw == null) return null;
  let obj: Record<string, unknown> | null = null;
  try {
    obj = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  // Tolerate a few likely shapes without assuming one.
  const summary = obj.summary ?? obj.headline ?? obj.primary_pain ?? obj.primary;
  if (typeof summary === 'string' && summary.trim()) return summary.trim();
  const cat = obj.pain_category ?? obj.category;
  if (typeof cat === 'string' && cat.trim()) return cat.trim();
  const list = obj.pains ?? obj.pain_points ?? obj.points;
  if (Array.isArray(list) && list.length > 0) {
    const first = list[0];
    if (typeof first === 'string' && first.trim()) return first.trim();
    if (first && typeof first === 'object') {
      const label = (first as Record<string, unknown>).label ?? (first as Record<string, unknown>).name;
      if (typeof label === 'string' && label.trim()) return label.trim();
    }
  }
  return null;
}

function toIso(v: string | Date | null): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The client's own leads, highest Living Score first. Returns [] when the
 * account has no client_id yet (never matches the operator's NULL pipeline).
 */
export async function listClientLeads(user: { client_id: number | null }): Promise<ClientLead[]> {
  const clientId = Number(user.client_id);
  if (!Number.isInteger(clientId) || clientId <= 0) return [];

  const db = getAvDb();
  const [rows] = await db.execute<LeadRow[]>(
    `SELECT id, audit_id, company, industry, contact_name, email, phone, website,
            lead_status, ai_score, ai_combined_score, ai_score_band,
            pain_point_profile, submission_date
       FROM leads
      WHERE archived_at IS NULL
        AND client_id = ?
      ORDER BY ai_combined_score IS NULL ASC,
               ai_combined_score DESC,
               submission_date DESC,
               id DESC
      LIMIT 200`,
    [clientId]
  );

  return rows.map((r) => ({
    id: r.id,
    auditId: r.audit_id,
    company: r.company || 'Untitled lead',
    industry: r.industry,
    contactName: r.contact_name && !r.contact_name.trim().startsWith('(') ? r.contact_name : null,
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
    painSummary: painSummaryOf(r.pain_point_profile),
    submittedAt: toIso(r.submission_date)
  }));
}
