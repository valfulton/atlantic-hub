/**
 * lib/av/cockpit_approvals.ts (#569, Tier 1.2)
 *
 * Server-side data access for the campaign cockpit's approval rows. This is
 * the table the cockpit reads, the Green Light button writes to, the Edit
 * modal updates, and the downstream dispatchers (press_touches, social_outbox,
 * calendar) link back to.
 *
 * Lifecycle (status):
 *   pending → approved (Green Light)  → published (publisher cron)
 *                     ↘ killed (×)
 *
 * Schema: 088_cockpit_approvals.sql.
 */
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export type ApprovalKind = 'commercial' | 'press_release' | 'op_ed' | 'social';
export type ApprovalStatus = 'pending' | 'approved' | 'killed' | 'published';

export interface CockpitApproval {
  id: number;
  clientId: number;
  kind: ApprovalKind;
  title: string;
  body: string | null;
  source: string | null;
  angle: string | null;
  status: ApprovalStatus;
  narrativeLineId: number | null;
  scheduledAt: string | null;
  approvedAt: string | null;
  killedAt: string | null;
  publishedAt: string | null;
  linkedPressTouchId: number | null;
  linkedOutboxId: number | null;
  linkedCalendarId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface RawRow extends RowDataPacket {
  approval_id: number;
  client_id: number;
  approval_kind: ApprovalKind;
  title: string;
  body_text: string | null;
  source: string | null;
  angle: string | null;
  status: ApprovalStatus;
  narrative_line_id: number | null;
  scheduled_at: string | null;
  approved_at: string | null;
  killed_at: string | null;
  published_at: string | null;
  linked_press_touch_id: number | null;
  linked_outbox_id: number | null;
  linked_calendar_id: number | null;
  created_at: string;
  updated_at: string;
}

function fromRow(r: RawRow): CockpitApproval {
  return {
    id: r.approval_id,
    clientId: r.client_id,
    kind: r.approval_kind,
    title: r.title,
    body: r.body_text,
    source: r.source,
    angle: r.angle,
    status: r.status,
    narrativeLineId: r.narrative_line_id,
    scheduledAt: r.scheduled_at,
    approvedAt: r.approved_at,
    killedAt: r.killed_at,
    publishedAt: r.published_at,
    linkedPressTouchId: r.linked_press_touch_id,
    linkedOutboxId: r.linked_outbox_id,
    linkedCalendarId: r.linked_calendar_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

/**
 * List approvals for a client (newest first). Degrades to [] when the table
 * is absent so the cockpit never falls over.
 */
export async function listApprovalsForClient(
  clientId: number,
  opts: { status?: ApprovalStatus | 'all'; limit?: number } = {}
): Promise<CockpitApproval[]> {
  if (!Number.isInteger(clientId) || clientId <= 0) return [];
  const limit = Math.max(1, Math.min(50, Math.floor(opts.limit ?? 12)));
  try {
    const db = getAvDb();
    const params: unknown[] = [clientId];
    let where = `client_id = ?`;
    if (opts.status && opts.status !== 'all') {
      where += ` AND status = ?`;
      params.push(opts.status);
    }
    const [rows] = await db.execute<RawRow[]>(
      `SELECT * FROM cockpit_approvals
        WHERE ${where}
        ORDER BY (status='pending') DESC, created_at DESC
        LIMIT ${limit}`,
      params
    );
    return rows.map(fromRow);
  } catch (err) {
    console.error('[cockpit_approvals:list]', clientId, (err as Error).message);
    return [];
  }
}

/**
 * Create an approval row (used when the cockpit first persists a generated
 * card OR when val composes one manually). Returns the new id, or 0 on miss.
 */
export interface CreateApprovalInput {
  clientId: number;
  kind: ApprovalKind;
  title: string;
  body?: string | null;
  source?: string | null;
  angle?: string | null;
  narrativeLineId?: number | null;
  scheduledAt?: string | null;
  status?: ApprovalStatus;
}

export async function createApproval(input: CreateApprovalInput): Promise<number> {
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO cockpit_approvals
         (tenant_id, client_id, approval_kind, title, body_text, source, angle,
          status, narrative_line_id, scheduled_at)
       VALUES ('av', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.clientId,
        input.kind,
        input.title.trim().slice(0, 300),
        input.body?.trim() || null,
        input.source?.trim().slice(0, 500) || null,
        input.angle?.trim().slice(0, 8) || null,
        input.status ?? 'pending',
        input.narrativeLineId ?? null,
        input.scheduledAt ?? null
      ]
    );
    return res.insertId ?? 0;
  } catch (err) {
    console.error('[cockpit_approvals:create]', (err as Error).message);
    return 0;
  }
}

/**
 * Mark an approval as approved (Green Light) and stamp who/when.
 * Caller chains this with the dispatch fns below.
 */
export async function approveApproval(
  approvalId: number,
  approvedByUserId: number | null
): Promise<boolean> {
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE cockpit_approvals
          SET status = 'approved',
              approved_at = NOW(),
              approved_by_user_id = ?
        WHERE approval_id = ? AND status IN ('pending','killed')`,
      [approvedByUserId, approvalId]
    );
    return (res.affectedRows ?? 0) > 0;
  } catch (err) {
    console.error('[cockpit_approvals:approve]', (err as Error).message);
    return false;
  }
}

/** Soft-kill (operator clicked ×). Reversible: greenlight can re-approve. */
export async function killApproval(
  approvalId: number,
  killedByUserId: number | null
): Promise<boolean> {
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE cockpit_approvals
          SET status = 'killed',
              killed_at = NOW(),
              killed_by_user_id = ?
        WHERE approval_id = ? AND status = 'pending'`,
      [killedByUserId, approvalId]
    );
    return (res.affectedRows ?? 0) > 0;
  } catch (err) {
    console.error('[cockpit_approvals:kill]', (err as Error).message);
    return false;
  }
}

/** Update body_text / title (Edit modal). */
export async function updateApprovalContent(
  approvalId: number,
  changes: { title?: string; body?: string | null; source?: string | null; scheduledAt?: string | null }
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (changes.title !== undefined)       { sets.push('title = ?');        params.push(changes.title.trim().slice(0, 300)); }
  if (changes.body !== undefined)        { sets.push('body_text = ?');    params.push(changes.body); }
  if (changes.source !== undefined)      { sets.push('source = ?');       params.push(changes.source?.slice(0, 500) ?? null); }
  if (changes.scheduledAt !== undefined) { sets.push('scheduled_at = ?'); params.push(changes.scheduledAt); }
  if (sets.length === 0) return true;
  params.push(approvalId);
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE cockpit_approvals SET ${sets.join(', ')} WHERE approval_id = ?`,
      params
    );
    return (res.affectedRows ?? 0) > 0;
  } catch (err) {
    console.error('[cockpit_approvals:updateContent]', (err as Error).message);
    return false;
  }
}

/** After dispatch, store the downstream row id so we can trace. */
export async function linkDispatch(
  approvalId: number,
  link: { pressTouchId?: number; outboxId?: number; calendarId?: number }
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (link.pressTouchId) { sets.push('linked_press_touch_id = ?'); params.push(link.pressTouchId); }
  if (link.outboxId)     { sets.push('linked_outbox_id = ?');      params.push(link.outboxId); }
  if (link.calendarId)   { sets.push('linked_calendar_id = ?');    params.push(link.calendarId); }
  if (sets.length === 0) return;
  params.push(approvalId);
  try {
    const db = getAvDb();
    await db.execute(`UPDATE cockpit_approvals SET ${sets.join(', ')} WHERE approval_id = ?`, params);
  } catch (err) {
    console.error('[cockpit_approvals:linkDispatch]', (err as Error).message);
  }
}

/** Mark published (used by publisher cron once outbox/press fires). */
export async function markPublished(approvalId: number): Promise<void> {
  try {
    const db = getAvDb();
    await db.execute(
      `UPDATE cockpit_approvals SET status='published', published_at = NOW() WHERE approval_id = ?`,
      [approvalId]
    );
  } catch (err) {
    console.error('[cockpit_approvals:markPublished]', (err as Error).message);
  }
}

/** Count pending approvals for a client (cockpit pulse meter). */
export async function countPendingApprovals(clientId: number): Promise<number> {
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
