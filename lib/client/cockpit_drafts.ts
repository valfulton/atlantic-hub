/**
 * lib/client/cockpit_drafts.ts  (#578, 2026-06-10)
 *
 * Client-side read of cockpit_approvals — the drafts the operator (val) has
 * generated or hand-written for this client. The CLIENT side gets:
 *   - title, body, kind, status, scheduled_at
 *   - the CAMPAIGN NAME (LEFT JOIN narrative_lanes.name) so each card carries
 *     "Campaign: Procedural Justice · A Doctor I Know" inline — the visibility
 *     val asked for so cards stop feeling disconnected from the spine.
 *
 * What the client does NOT see (and should not):
 *   - source provenance string (it names brief fields — engine vocab)
 *   - linked_press_touch_id / linked_outbox_id / linked_calendar_id
 *   - approved_by_user_id / killed_by_user_id (audit fields)
 *   - the body of `killed` rows (operator dismissed them; out of view)
 *
 * Soft-fail to [] on any DB miss so the dashboard never breaks if schema 088
 * isn't applied somewhere.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';
import type { ApprovalKind, ApprovalStatus } from '@/lib/av/cockpit_approvals';

export interface ClientCockpitDraft {
  id: number;
  kind: ApprovalKind;
  /** Card headline shown on the dashboard. */
  title: string;
  /** Full body text. Visible inline (expandable in the UI). Null until the
   *  generator runs or val hand-writes. */
  body: string | null;
  /** "press_release" → "Press release" etc. — friendly display kind. */
  kindLabel: string;
  status: ApprovalStatus;
  /** Optional ISO datetime the operator scheduled this for. */
  scheduledAt: string | null;
  /** Campaign name from narrative_lanes.name. NULL when the card isn't tied
   *  to a campaign yet (rare; the title generator threads them by default). */
  campaignName: string | null;
  campaignId: number | null;
  /** Word count of the body, for the "Draft · 247 words" preview line. */
  bodyWordCount: number;
  createdAt: string;
  updatedAt: string;
}

const KIND_LABEL: Record<ApprovalKind, string> = {
  press_release: 'Press release',
  op_ed: 'Op-ed',
  social: 'Social post',
  commercial: 'Commercial'
};

function countWords(text: string | null): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

interface RawRow extends RowDataPacket {
  approval_id: number;
  approval_kind: ApprovalKind;
  title: string;
  body_text: string | null;
  status: ApprovalStatus;
  scheduled_at: string | null;
  narrative_line_id: number | null;
  campaign_name: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * List drafts visible on the client dashboard for a given client. Pending +
 * approved + published; killed rows are filtered out. Newest pending first
 * (so "needs your eyes" sits at the top), then approved/published below.
 */
export async function listDraftsForClient(
  clientId: number,
  opts: { limit?: number } = {}
): Promise<ClientCockpitDraft[]> {
  if (!Number.isInteger(clientId) || clientId <= 0) return [];
  const limit = Math.max(1, Math.min(30, Math.floor(opts.limit ?? 12)));
  try {
    const db = getAvDb();
    const [rows] = await db.execute<RawRow[]>(
      `SELECT
         a.approval_id,
         a.approval_kind,
         a.title,
         a.body_text,
         a.status,
         a.scheduled_at,
         a.narrative_line_id,
         n.name AS campaign_name,
         a.created_at,
         a.updated_at
       FROM cockpit_approvals a
       LEFT JOIN narrative_lanes n
         ON n.id = a.narrative_line_id AND n.client_id = a.client_id
       WHERE a.client_id = ? AND a.status IN ('pending','approved','published')
       ORDER BY FIELD(a.status,'pending','approved','published'), a.created_at DESC
       LIMIT ${limit}`,
      [clientId]
    );
    return rows.map((r): ClientCockpitDraft => ({
      id: r.approval_id,
      kind: r.approval_kind,
      kindLabel: KIND_LABEL[r.approval_kind] ?? r.approval_kind,
      title: r.title,
      body: r.body_text,
      status: r.status,
      scheduledAt: r.scheduled_at,
      narrativeLineId: r.narrative_line_id,
      campaignName: r.campaign_name?.trim() || null,
      campaignId: r.narrative_line_id,
      bodyWordCount: countWords(r.body_text),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    } as ClientCockpitDraft & { narrativeLineId: number | null }));
  } catch (err) {
    console.error('[client_cockpit_drafts:list]', clientId, (err as Error).message);
    return [];
  }
}

/** Count of drafts currently waiting on val (status='pending') for the cockpit
 *  meter on the operator side AND for the "Your team is working on N drafts"
 *  line on the client side. Soft-fail to 0. */
export async function countPendingDraftsForClient(clientId: number): Promise<number> {
  if (!Number.isInteger(clientId) || clientId <= 0) return 0;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { n: number })[]>(
      `SELECT COUNT(*) AS n FROM cockpit_approvals
        WHERE client_id = ? AND status = 'pending'`,
      [clientId]
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}
