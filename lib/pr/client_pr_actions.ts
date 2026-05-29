/**
 * lib/pr/client_pr_actions.ts  (#220)
 *
 * Client-scoped data access for the client-facing PR view at /client/pr.
 *
 * Two responsibilities:
 *   1. listPrOpportunitiesForClientView -- read opportunities matched to a
 *      client's leads, *plus* the client-side approval state, in a shape the
 *      client portal can render without seeing operator machinery.
 *   2. recordClientApproval -- the single write path for the three client
 *      actions (approve / decline / request review). Double-scoped: the
 *      pitch must (a) exist and (b) belong to a lead that THIS client owns.
 *
 * Reuses the join from lib/pr/per_client.ts (the operator-side variant) so
 * we never drift on what counts as "this client's PR." Adds client_approval
 * columns from schema 062.
 *
 * Privacy wall: every query here MUST scope by client_id (the caller's
 * verified client_id, NEVER a value from the request body). The route
 * handlers in /api/client/pr/* pass it through after reading the
 * client session header.
 */
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { logEvent } from '@/lib/events/log';

export type PrOpportunityStatus = 'new' | 'drafted' | 'submitted' | 'won' | 'passed';
export type PrPitchStatus = 'draft' | 'approved' | 'sent' | 'declined';
export type ClientApproval = 'approved' | 'declined' | 'review_requested';

export interface ClientFacingPrOpportunity {
  id: number;
  /** Outlet + journalist combined into a single display title. */
  title: string;
  outlet: string | null;
  journalist: string | null;
  /** The journalist request / query body. */
  queryText: string | null;
  topicTags: string[];
  /** Operator-authored "why this matters for you" guidance. */
  whyItMatters: string | null;
  deadline: string | null;
  /** Days until deadline; negative = past. */
  decayDays: number | null;
  /** Operator-side opportunity lifecycle. */
  status: PrOpportunityStatus;
  /** The lead (their lead!) this opportunity is matched to. */
  matchedLeadCompany: string | null;
  matchedLeadAuditId: string | null;
  /** Pitch info if val has already drafted one. */
  pitchId: number | null;
  pitchStatus: PrPitchStatus | null;
  /** The drafted pitch body the client can read before approving. */
  pitchBody: string | null;
  /** What the CLIENT has done (approve/decline/review) -- separate from operator status. */
  clientApproval: ClientApproval | null;
  clientApprovalAt: string | null;
  clientNote: string | null;
  createdAt: string;
}

interface Row extends RowDataPacket {
  id: number;
  outlet: string | null;
  journalist: string | null;
  query_text: string | null;
  topic_tags: string | object | null;
  why_it_matters: string | null;
  deadline: string | null;
  status: PrOpportunityStatus;
  matched_lead_id: number | null;
  lead_company: string | null;
  lead_audit_id: string | null;
  pitch_id: number | null;
  pitch_status: PrPitchStatus | null;
  pitch_body: string | null;
  client_approval: ClientApproval | null;
  client_approval_at: string | null;
  client_note: string | null;
  created_at: string;
}

function safeJson(raw: string | object | null): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  if (typeof raw === 'object') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function decayDaysFor(deadline: string | null): number | null {
  if (!deadline) return null;
  const t = new Date(deadline).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.now()) / 86_400_000);
}

function titleFor(outlet: string | null, journalist: string | null, queryText: string | null, id: number): string {
  if (outlet && journalist) return `${outlet} — ${journalist}`;
  if (outlet) return outlet;
  if (journalist) return journalist;
  if (queryText) return queryText.slice(0, 80);
  return `Opportunity #${id}`;
}

/**
 * Opportunities matched to leads belonging to this client. Excludes 'passed'
 * (val already dismissed) by default. Ordered: live deadlines first
 * (soonest deadline ascending), then by created_at desc.
 */
export async function listPrOpportunitiesForClientView(
  clientId: number,
  opts: { limit?: number; includeClosed?: boolean } = {}
): Promise<ClientFacingPrOpportunity[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 30, 100));
  const db = getAvDb();

  // We exclude 'passed' (operator dismissed) AND any pitch the client already
  // declined, by default. Approvals + review_requests + untouched ones stay.
  const closedFilter = opts.includeClosed
    ? ''
    : `AND o.status NOT IN ('passed') AND (p.client_approval IS NULL OR p.client_approval IN ('approved','review_requested'))`;

  const [rows] = await db.execute<Row[]>(
    `SELECT
        o.id, o.outlet, o.journalist, o.query_text, o.topic_tags,
        o.why_it_matters, o.deadline, o.status, o.matched_lead_id,
        l.company AS lead_company, l.audit_id AS lead_audit_id,
        p.id AS pitch_id, p.status AS pitch_status, p.body_text AS pitch_body,
        p.client_approval, p.client_approval_at, p.client_note,
        o.created_at
       FROM pr_opportunities o
       JOIN leads l ON l.id = o.matched_lead_id AND l.archived_at IS NULL
       LEFT JOIN pr_pitches p ON p.opportunity_id = o.id AND p.lead_id = o.matched_lead_id
      WHERE l.client_id = ? ${closedFilter}
      ORDER BY
        CASE WHEN o.deadline IS NULL THEN 1 ELSE 0 END,
        o.deadline ASC,
        o.created_at DESC
      LIMIT ${limit}`,
    [clientId]
  );

  return rows.map((r) => ({
    id: r.id,
    title: titleFor(r.outlet, r.journalist, r.query_text, r.id),
    outlet: r.outlet,
    journalist: r.journalist,
    queryText: r.query_text,
    topicTags: safeJson(r.topic_tags),
    whyItMatters: r.why_it_matters,
    deadline: r.deadline,
    decayDays: decayDaysFor(r.deadline),
    status: r.status,
    matchedLeadCompany: r.lead_company,
    matchedLeadAuditId: r.lead_audit_id,
    pitchId: r.pitch_id,
    pitchStatus: r.pitch_status,
    pitchBody: r.pitch_body,
    clientApproval: r.client_approval,
    clientApprovalAt: r.client_approval_at,
    clientNote: r.client_note,
    createdAt: r.created_at
  }));
}

export interface ClientPrSummary {
  total: number;
  awaitingMyApproval: number;
  iApproved: number;
  iSentForReview: number;
  urgent: number;
}

export function summarizeForClient(opps: ClientFacingPrOpportunity[]): ClientPrSummary {
  let awaitingMyApproval = 0;
  let iApproved = 0;
  let iSentForReview = 0;
  let urgent = 0;
  for (const o of opps) {
    if (o.pitchId && o.clientApproval === null && o.pitchStatus !== 'sent') awaitingMyApproval += 1;
    if (o.clientApproval === 'approved') iApproved += 1;
    if (o.clientApproval === 'review_requested') iSentForReview += 1;
    if (typeof o.decayDays === 'number' && o.decayDays >= 0 && o.decayDays <= 7) urgent += 1;
  }
  return { total: opps.length, awaitingMyApproval, iApproved, iSentForReview, urgent };
}

/**
 * Record a client's approve/decline/review-request on a pitch.
 *
 * Double-scoped for safety: the pitch must (a) exist and (b) be tied to a
 * lead whose client_id matches the caller's verified client_id. We pass
 * client_id from the route after reading the client session -- never trust
 * a body-supplied value.
 *
 * Returns { ok: true } on success, { ok: false, error } otherwise. The
 * route handler turns that into JSON for the client.
 */
export async function recordClientApproval(args: {
  clientId: number;
  clientUserId: number;
  pitchId: number;
  decision: ClientApproval;
  note?: string | null;
}): Promise<{ ok: true; pitchId: number } | { ok: false; error: string; status: number }> {
  const { clientId, clientUserId, pitchId, decision } = args;
  const note = (args.note || '').toString().trim().slice(0, 4000) || null;

  if (!['approved', 'declined', 'review_requested'].includes(decision)) {
    return { ok: false, error: 'invalid decision', status: 400 };
  }

  const db = getAvDb();

  // Privacy wall: confirm this pitch's lead belongs to this client.
  const [own] = await db.execute<(RowDataPacket & {
    pitch_id: number;
    opportunity_id: number;
    lead_id: number;
    pitch_status: PrPitchStatus | null;
    current_approval: ClientApproval | null;
  })[]>(
    `SELECT
        p.id AS pitch_id, p.opportunity_id, p.lead_id,
        p.status AS pitch_status, p.client_approval AS current_approval
       FROM pr_pitches p
       JOIN leads l ON l.id = p.lead_id
      WHERE p.id = ?
        AND l.client_id = ?
        AND l.archived_at IS NULL
      LIMIT 1`,
    [pitchId, clientId]
  );
  if (!own[0]) return { ok: false, error: 'not your pitch', status: 404 };

  // If the pitch is already sent, don't let the client retroactively reverse it.
  if (own[0].pitch_status === 'sent') {
    return { ok: false, error: 'pitch already sent', status: 409 };
  }

  await db.execute<ResultSetHeader>(
    `UPDATE pr_pitches
        SET client_approval = ?,
            client_approval_at = NOW(),
            client_approval_by_user_id = ?,
            client_note = COALESCE(?, client_note),
            updated_at = NOW()
      WHERE id = ?`,
    [decision, clientUserId, note, pitchId]
  );

  // When a client declines, we also flip the pitch status to 'declined' so
  // the operator desk shows it as closed-out without further action.
  if (decision === 'declined') {
    await db.execute<ResultSetHeader>(
      `UPDATE pr_pitches SET status = 'declined' WHERE id = ?`,
      [pitchId]
    );
  }

  await logEvent({
    eventType: `pr.pitch.client_${decision}`,
    leadId: own[0].lead_id,
    userId: null,
    source: 'client_portal',
    status: 'success',
    payload: {
      pitch_id: pitchId,
      opportunity_id: own[0].opportunity_id,
      client_id: clientId,
      client_user_id: clientUserId,
      previous_approval: own[0].current_approval,
      note_chars: note ? note.length : 0
    }
  });

  return { ok: true, pitchId };
}
