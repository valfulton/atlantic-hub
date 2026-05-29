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

/** Website data-quality flag (#180/#195). Stored on leads.website_status. */
export type WebsiteStatus = 'unknown' | 'valid' | 'placeholder' | 'dead';

export interface ClientLead {
  id: number;
  auditId: string | null;
  company: string;
  industry: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  websiteStatus: WebsiteStatus;
  /** Address fields populated from source_payload backfill + future enrichment (#180). */
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressPostal: string | null;
  addressCountry: string | null;
  leadStatus: string;
  /** The visible Living Score: combined when present, else fit-only. */
  score: number | null;
  band: LeadBand;
  /** (#95) 0-100 fit score against THIS client's brief + ICP. NULL when the
   *  lead hasn't been scored yet OR when the client has no brief to score
   *  against. Distinct from `score` (which is the generic AV audit signal). */
  icpFitScore: number | null;
  /** One-sentence reason the scorer wrote; surfaces as a tooltip / subline. */
  icpFitReasoning: string | null;
  /** (#90) When the lead's audit was last regenerated. NULL = never audited. */
  auditGeneratedAt: string | null;
  /** (#90) True when the audit was generated BEFORE the owning client's brief
   *  was last edited — i.e. the audit is grounded in an outdated brief and
   *  should be re-run via the RefreshIntelPanel. Also true when there's no
   *  audit at all and a brief exists. */
  auditStale: boolean;
  /** A short, human pain summary if one has been extracted; else null. */
  painSummary: string | null;
  /** The "what to say on the call" script from the lead's pain profile. */
  callScript: {
    primaryPain: string | null;
    urgency: string | null;
    openers: string[];
    avoid: string[];
  } | null;
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
  website_status: WebsiteStatus | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal: string | null;
  address_country: string | null;
  lead_status: string | null;
  ai_score: number | null;
  ai_combined_score: number | null;
  ai_score_band: LeadBand;
  // (#95) Per-client ICP-fit score + reasoning. Populated by the bulk-scorer
  // run from the client page.
  client_icp_fit_score: number | null;
  client_icp_fit_reasoning: string | null;
  // (#90) When the lead's audit was last regenerated.
  audit_generated: string | Date | null;
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

/** Parse the full "what to say on the call" script from the pain profile JSON. */
function callScriptOf(raw: string | object | null): ClientLead['callScript'] {
  if (raw == null) return null;
  let obj: Record<string, unknown> | null = null;
  try {
    obj = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  const openers = strArr(obj.conversation_starters ?? obj.openers);
  const avoid = strArr(obj.do_not_say ?? obj.avoid);
  const primaryPain = typeof obj.primary_pain === 'string' && obj.primary_pain.trim() ? obj.primary_pain.trim() : null;
  const urgency = typeof obj.urgency_signal === 'string' && obj.urgency_signal.trim() ? obj.urgency_signal.trim() : null;
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
 * The client's own leads, highest Living Score first. Returns [] when the
 * account has no client_id yet (never matches the operator's NULL pipeline).
 */
export async function listClientLeads(user: { client_id: number | null }): Promise<ClientLead[]> {
  const clientId = Number(user.client_id);
  if (!Number.isInteger(clientId) || clientId <= 0) return [];

  const db = getAvDb();

  // (#90) Fetch the client's brief updated_at ONCE so we can stamp every
  // lead with whether its audit is stale relative to the current brief. The
  // brief is the canonical source the audit was grounded in — if val edited
  // the brief after the audit ran, that audit is grounding in old positioning.
  let briefUpdatedAt: Date | null = null;
  try {
    const [briefRows] = await db.execute<(RowDataPacket & { updated_at: string | Date })[]>(
      `SELECT updated_at FROM creative_briefs
        WHERE tenant_id = 'av' AND client_id = ?
        ORDER BY updated_at DESC LIMIT 1`,
      [clientId]
    );
    const rawTs = briefRows[0]?.updated_at;
    briefUpdatedAt = rawTs ? new Date(rawTs) : null;
  } catch { /* non-fatal: staleness silently false everywhere */ }

  const [rows] = await db.execute<LeadRow[]>(
    `SELECT id, audit_id, company, industry, contact_name, email, phone, website,
            website_status,
            address_street, address_city, address_state, address_postal, address_country,
            lead_status, ai_score, ai_combined_score, ai_score_band,
            client_icp_fit_score, client_icp_fit_reasoning,
            audit_generated,
            pain_point_profile, submission_date
       FROM leads
      WHERE archived_at IS NULL
        AND client_id = ?
      ORDER BY client_icp_fit_score IS NULL ASC,
               client_icp_fit_score DESC,
               ai_combined_score IS NULL ASC,
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
    websiteStatus: (r.website_status ?? 'unknown') as WebsiteStatus,
    addressStreet: r.address_street && r.address_street.trim() ? r.address_street : null,
    addressCity: r.address_city && r.address_city.trim() ? r.address_city : null,
    addressState: r.address_state && r.address_state.trim() ? r.address_state : null,
    addressPostal: r.address_postal && r.address_postal.trim() ? r.address_postal : null,
    addressCountry: r.address_country && r.address_country.trim() ? r.address_country : null,
    leadStatus: r.lead_status || 'new',
    score:
      r.ai_combined_score !== null
        ? Number(r.ai_combined_score)
        : r.ai_score !== null
          ? Number(r.ai_score)
          : null,
    band: r.ai_score_band,
    icpFitScore: r.client_icp_fit_score == null ? null : Number(r.client_icp_fit_score),
    icpFitReasoning: r.client_icp_fit_reasoning && r.client_icp_fit_reasoning.trim() ? r.client_icp_fit_reasoning.trim() : null,
    auditGeneratedAt: toIso(r.audit_generated),
    // (#90) Stale when: brief exists AND (audit is missing OR audit is older
    // than the latest brief edit). If no brief is on file yet, nothing is
    // "stale" -- there's no canonical positioning to be out of sync with.
    auditStale: (() => {
      if (!briefUpdatedAt) return false;
      if (!r.audit_generated) return true; // brief exists, audit doesn't
      const auditTs = new Date(r.audit_generated as string | Date);
      return auditTs.getTime() < briefUpdatedAt.getTime();
    })(),
    painSummary: painSummaryOf(r.pain_point_profile),
    callScript: callScriptOf(r.pain_point_profile),
    submittedAt: toIso(r.submission_date)
  }));
}
