/**
 * lib/pr/per_client.ts  (#213 Part A)
 *
 * Per-client PR opportunity listing for the operator-side client page. Before
 * this file, val had only the global PR inbox at /admin/pr -- there was no
 * way to ask "what's running for John White right now?".
 *
 * Joins pr_opportunities -> leads (matched_lead_id) -> clients to filter to
 * opportunities whose matched_lead belongs to THIS client. Also joins any
 * existing pr_pitches drafted for that opportunity + lead so the panel can
 * show "drafted" vs "still raw" at a glance.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export type PrOpportunityStatus = 'new' | 'drafted' | 'submitted' | 'won' | 'passed';
export type PrPitchStatus = 'draft' | 'approved' | 'sent' | 'declined';

export interface ClientPrOpportunity {
  id: number;
  tenantId: string;
  source: string;
  outlet: string | null;
  journalist: string | null;
  queryText: string | null;
  topicTags: string[];
  whyItMatters: string | null;
  deadline: string | null;
  /** Days until deadline (negative = past). null when no deadline. */
  decayDays: number | null;
  relevanceScore: number | null;
  origin: string | null;
  /** Suggested vs ingested (true = internal-signal suggestion, false = real inbound). */
  suggested: boolean;
  status: PrOpportunityStatus;
  matchedLeadId: number | null;
  matchedLeadCompany: string | null;
  /** Pitch info if a draft exists for this opportunity + matched lead. */
  pitchId: number | null;
  pitchStatus: PrPitchStatus | null;
  /** Snippet of the pitch body for quick preview (first 240 chars). */
  pitchPreview: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row extends RowDataPacket {
  id: number;
  tenant_id: string;
  source: string;
  outlet: string | null;
  journalist: string | null;
  query_text: string | null;
  topic_tags: string | object | null;
  why_it_matters: string | null;
  deadline: string | null;
  relevance_score: number | null;
  origin: string | null;
  suggested: number | string | boolean;
  status: PrOpportunityStatus;
  matched_lead_id: number | null;
  lead_company: string | null;
  pitch_id: number | null;
  pitch_status: PrPitchStatus | null;
  pitch_body: string | null;
  created_at: string;
  updated_at: string;
}

function safeJson(raw: string | object | null): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  if (typeof raw === 'object') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

function decayDaysFor(deadline: string | null): number | null {
  if (!deadline) return null;
  const t = new Date(deadline).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.now()) / 86_400_000);
}

/**
 * Every PR opportunity matched to a lead owned by this client, plus its drafted
 * pitch (if any). Most-actionable first: live deadlines ascending, then by
 * relevance score descending. Excludes status='passed' and won't return
 * archived leads.
 *
 * @param clientId  internal `clients.client_id`
 * @param opts.includePassed include passed/won so a "history" view can render
 * @param opts.limit         row cap (default 50, max 200)
 */
export async function listPrOpportunitiesForClient(
  clientId: number,
  opts: { includePassed?: boolean; limit?: number } = {}
): Promise<ClientPrOpportunity[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const db = getAvDb();

  const statusFilter = opts.includePassed
    ? ''
    : `AND o.status NOT IN ('passed')`;

  // Join via matched_lead_id -> leads.client_id. LEFT JOIN to pr_pitches so
  // opportunities WITHOUT a draft still surface (those are the actionable
  // ones for val to draft next).
  const [rows] = await db.execute<Row[]>(
    `SELECT
        o.id, o.tenant_id, o.source, o.outlet, o.journalist, o.query_text,
        o.topic_tags, o.why_it_matters, o.deadline, o.relevance_score,
        o.origin, o.suggested, o.status, o.matched_lead_id,
        l.company AS lead_company,
        p.id AS pitch_id, p.status AS pitch_status, p.body_text AS pitch_body,
        o.created_at, o.updated_at
       FROM pr_opportunities o
       JOIN leads l ON l.id = o.matched_lead_id AND l.archived_at IS NULL
       LEFT JOIN pr_pitches p ON p.opportunity_id = o.id AND p.lead_id = o.matched_lead_id
      WHERE l.client_id = ? ${statusFilter}
      ORDER BY
        CASE WHEN o.deadline IS NULL THEN 1 ELSE 0 END,
        o.deadline ASC,
        o.relevance_score DESC,
        o.created_at DESC
      LIMIT ${limit}`,
    [clientId]
  );

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    source: r.source,
    outlet: r.outlet,
    journalist: r.journalist,
    queryText: r.query_text,
    topicTags: safeJson(r.topic_tags),
    whyItMatters: r.why_it_matters,
    deadline: r.deadline,
    decayDays: decayDaysFor(r.deadline),
    relevanceScore: r.relevance_score,
    origin: r.origin,
    suggested: r.suggested === 1 || r.suggested === '1' || r.suggested === true,
    status: r.status,
    matchedLeadId: r.matched_lead_id,
    matchedLeadCompany: r.lead_company,
    pitchId: r.pitch_id,
    pitchStatus: r.pitch_status,
    pitchPreview: r.pitch_body ? r.pitch_body.slice(0, 240) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

/** Quick stats for a client's PR pipeline header. */
export interface ClientPrStats {
  total: number;
  awaitingDraft: number;
  drafted: number;
  submitted: number;
  won: number;
  /** Opportunities with a deadline within 7 days (regardless of draft state). */
  urgent: number;
}

export function summarize(opps: ClientPrOpportunity[]): ClientPrStats {
  let awaitingDraft = 0;
  let drafted = 0;
  let submitted = 0;
  let won = 0;
  let urgent = 0;
  for (const o of opps) {
    if (o.status === 'new' && !o.pitchId) awaitingDraft += 1;
    if (o.status === 'drafted' || o.pitchStatus === 'draft') drafted += 1;
    if (o.status === 'submitted' || o.pitchStatus === 'sent') submitted += 1;
    if (o.status === 'won') won += 1;
    if (typeof o.decayDays === 'number' && o.decayDays >= 0 && o.decayDays <= 7) urgent += 1;
  }
  return { total: opps.length, awaitingDraft, drafted, submitted, won, urgent };
}
