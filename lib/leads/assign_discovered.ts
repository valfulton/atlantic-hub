/**
 * lib/leads/assign_discovered.ts
 *
 * Shared helper for the "Send pulled leads to → an employee" destination on the
 * discovery forms. After a discovery batch inserts new leads, the route collects
 * the freshly-inserted lead ids and stamps them with assigned_to_user_id so they
 * land in that sales rep's queue (still in the AV pipeline, just owned by them).
 *
 * Mirrors the client_id destination, which stamps leads to a client's hub. The
 * two are mutually exclusive in the UI: a pull goes to AV (default), to a client
 * hub (client_id), OR to a rep (assigned_to_user_id).
 */
import { getAvDb } from '@/lib/db/av';
import { getPlatformDb } from '@/lib/db/platform';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

/** True when userId is a real, active owner/staff admin user (assignable).
 *  admin_users lives in the platform db (same table /login uses), not the AV db. */
export async function isAssignableUser(userId: number): Promise<boolean> {
  if (!Number.isInteger(userId) || userId <= 0) return false;
  const db = getPlatformDb();
  const [rows] = await db.execute<(RowDataPacket & { user_id: number })[]>(
    `SELECT user_id FROM admin_users
      WHERE user_id = ? AND role IN ('owner', 'staff') AND is_active = 1 LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

/**
 * Stamp assigned_to_user_id on the given freshly-inserted leads. No-ops (returns 0)
 * if the target isn't an assignable user or there are no lead ids. Returns the
 * number of rows updated.
 */
export async function assignDiscoveredLeads(
  leadIds: Array<number | undefined>,
  assignToUserId: number,
  actorUserId: number | null
): Promise<number> {
  const ids = leadIds.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0);
  if (ids.length === 0) return 0;
  if (!(await isAssignableUser(assignToUserId))) return 0;

  const db = getAvDb();
  const placeholders = ids.map(() => '?').join(', ');
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE leads SET assigned_to_user_id = ?, last_activity_at = NOW() WHERE id IN (${placeholders})`,
    [assignToUserId, ...ids]
  );

  await logEvent({
    eventType: 'lead.assignment_changed',
    userId: actorUserId,
    source: 'discovery',
    status: 'success',
    payload: { assignToUserId, leadCount: ids.length, leadIds: ids, via: 'find_new_leads' }
  }).catch(() => {});

  return res.affectedRows ?? 0;
}

/** Parse an optional assignToUserId out of a request payload (positive int or null). */
export function parseAssignToUserId(payload: Record<string, unknown>): number | null {
  const v = payload.assignToUserId;
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}
