/**
 * lib/leads/lifecycle.ts
 *
 * Lifecycle helpers for the extended lead_status enum. The enum widened
 * in schema 019:
 *
 *   new -> contacted -> qualified -> converted   (happy path)
 *                                  -> lost       (dead)
 *                                  -> nurture    (parked w/ wake_at_date)
 *                                  -> not_now    (timing wrong, set wake_at_date)
 *                                  -> referred   (sent them elsewhere)
 *                                  -> case_study (closed-won + reusable content)
 *
 * Behavior-based wake: when a parked lead (nurture / not_now) receives
 * a positive engagement signal, automatically flip status back to
 * "contacted" and clear wake_at_date. Wired into engagement_score.ts
 * via the maybeWakeOnEngagement helper.
 *
 * Date-based wake: the nurture-wake-cron sweeps daily for any lead in
 * nurture / not_now with wake_at_date <= today, flips status back to
 * "contacted", clears wake_at_date, logs an event.
 */

import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const LIFECYCLE_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'converted',
  'lost',
  'nurture',
  'not_now',
  'referred',
  'case_study'
] as const;

export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

const PARKED_STATUSES: LifecycleStatus[] = ['nurture', 'not_now'];
const TERMINAL_STATUSES: LifecycleStatus[] = ['converted', 'lost', 'case_study'];

export function isParked(status: string): boolean {
  return PARKED_STATUSES.includes(status as LifecycleStatus);
}

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(status as LifecycleStatus);
}

export function isValidStatus(s: string): s is LifecycleStatus {
  return (LIFECYCLE_STATUSES as readonly string[]).includes(s);
}

/**
 * Default wake date when parking a lead. Used by the UI as a placeholder.
 *   nurture -> 30 days
 *   not_now -> 14 days
 */
export function defaultWakeDate(status: LifecycleStatus): string | null {
  const days = status === 'nurture' ? 30 : status === 'not_now' ? 14 : 0;
  if (days === 0) return null;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Transition a lead to a new lifecycle status. Handles side effects:
 *   - parking (nurture / not_now / referred) sets wake_at_date + parked_reason
 *   - unparking (anything else) clears wake_at_date and parked_reason
 *   - logs lifecycle event
 *
 * Returns the new status on success, null on error.
 */
export async function transitionLeadStatus(opts: {
  leadId: number;
  toStatus: LifecycleStatus;
  wakeAtDate?: string | null;
  parkedReason?: string | null;
  actorUserId?: number | null;
}): Promise<LifecycleStatus | null> {
  const db = getAvDb();
  try {
    const [rows] = await db.execute<(RowDataPacket & { id: number; lead_status: string; client_id: number | null })[]>(
      `SELECT id, lead_status, client_id FROM leads WHERE id = ? AND archived_at IS NULL LIMIT 1`,
      [opts.leadId]
    );
    if (rows.length === 0) return null;
    const prev = rows[0].lead_status;

    const setClauses: string[] = ['lead_status = ?', 'last_activity_at = NOW()'];
    const values: unknown[] = [opts.toStatus];

    if (PARKED_STATUSES.includes(opts.toStatus) || opts.toStatus === 'referred') {
      setClauses.push('wake_at_date = ?');
      values.push(opts.wakeAtDate ?? defaultWakeDate(opts.toStatus));
      setClauses.push('parked_reason = ?');
      values.push(opts.parkedReason ?? null);
    } else {
      // Unparking -- clear nurture metadata so it doesn't show stale on wake-up.
      setClauses.push('wake_at_date = NULL');
      setClauses.push('parked_reason = NULL');
    }

    await db.execute<ResultSetHeader>(
      `UPDATE leads SET ${setClauses.join(', ')} WHERE id = ?`,
      [...values, opts.leadId]
    );

    await logEvent({
      eventType: `lead.lifecycle.${opts.toStatus}`,
      leadId: opts.leadId,
      userId: opts.actorUserId ?? null,
      source: 'sales',
      status: 'success',
      payload: { from: prev, to: opts.toStatus, wake_at_date: opts.wakeAtDate ?? null, parked_reason: opts.parkedReason ?? null }
    });

    // Also fire a generic lead.stage_advanced event when moving forward
    // along the happy path -- it carries a +6 engagement bump.
    const forwardSteps: Record<string, string[]> = {
      new: ['contacted', 'qualified', 'converted'],
      contacted: ['qualified', 'converted'],
      qualified: ['converted']
    };
    if (forwardSteps[prev]?.includes(opts.toStatus)) {
      await logEvent({
        eventType: 'lead.stage_advanced',
        leadId: opts.leadId,
        userId: opts.actorUserId ?? null,
        source: 'sales',
        status: 'success',
        payload: { from: prev, to: opts.toStatus }
      });
    }
    if (opts.toStatus === 'converted') {
      await logEvent({
        eventType: 'lead.stage_converted',
        leadId: opts.leadId,
        userId: opts.actorUserId ?? null,
        source: 'sales',
        status: 'success',
        payload: { from: prev }
      });
    }

    return opts.toStatus;
  } catch (err) {
    console.error('[lifecycle:transition]', opts.leadId, (err as Error).message);
    return null;
  }
}

/**
 * Behavior-based wake: when a parked lead receives a positive engagement
 * delta, flip status back to "contacted". Called from engagement_score.ts
 * after applyEngagementSignal has persisted the new score.
 */
export async function maybeWakeOnEngagement(opts: {
  leadId: number;
  delta: number;
  triggerEventType: string;
}): Promise<void> {
  if (opts.delta <= 0) return;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { id: number; lead_status: string })[]>(
      `SELECT id, lead_status FROM leads WHERE id = ? AND archived_at IS NULL LIMIT 1`,
      [opts.leadId]
    );
    if (rows.length === 0) return;
    if (!isParked(rows[0].lead_status)) return;

    await db.execute<ResultSetHeader>(
      `UPDATE leads
          SET lead_status = 'contacted',
              wake_at_date = NULL,
              parked_reason = NULL,
              last_activity_at = NOW()
        WHERE id = ?`,
      [opts.leadId]
    );
    await logEvent({
      eventType: 'lead.lifecycle.woken_by_behavior',
      leadId: opts.leadId,
      source: 'sales',
      status: 'success',
      payload: { from: rows[0].lead_status, trigger: opts.triggerEventType, delta: opts.delta }
    });
  } catch (err) {
    console.error('[lifecycle:wake]', opts.leadId, (err as Error).message);
  }
}

/**
 * Date-based wake sweep. Called by the nurture-wake cron daily. Returns
 * the count + IDs of leads that woke.
 */
export async function runDateBasedWakeSweep(): Promise<{ woken: number; leadIds: number[] }> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads
      WHERE archived_at IS NULL
        AND lead_status IN ('nurture', 'not_now')
        AND wake_at_date IS NOT NULL
        AND wake_at_date <= CURDATE()
      LIMIT 500`
  );
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return { woken: 0, leadIds: [] };

  await db.query<ResultSetHeader>(
    `UPDATE leads
        SET lead_status = 'contacted',
            wake_at_date = NULL,
            parked_reason = NULL,
            last_activity_at = NOW()
      WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  );

  for (const leadId of ids) {
    await logEvent({
      eventType: 'lead.lifecycle.woken_by_date',
      leadId,
      source: 'cron',
      status: 'success'
    });
  }

  return { woken: ids.length, leadIds: ids };
}
