/**
 * lib/client/press_touches.ts
 *
 * Server-side data access for press_touches (#550 v2).
 *
 * Surfaces:
 *   - /client/dashboard PressTouchesPanel reads list + week count.
 *   - /admin/av/clients/[id]/press uses list + logTouch + updateStatus.
 *
 * Degrades gracefully: missing schema returns []/0 instead of throwing, so a
 * dashboard render never falls over when this migration hasn't been applied
 * yet on a given DB.
 */
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export type PressTouchStatus =
  | 'drafted'
  | 'pitched'
  | 'replied'
  | 'published'
  | 'declined'
  | 'no_response';

export type PressTouchChannel = 'email' | 'phone' | 'social_dm' | 'event' | 'other';

export interface PressTouch {
  id: number;
  clientId: number;
  journalist: string;
  journalistEmail: string | null;
  outlet: string;
  beat: string | null;
  channel: PressTouchChannel;
  status: PressTouchStatus;
  subject: string | null;
  notes: string | null;
  relatedLeadId: number | null;
  relatedBriefKey: string | null;
  url: string | null;
  createdByUserId: number | null;
  createdAt: string;
  pitchedAt: string | null;
  repliedAt: string | null;
  publishedAt: string | null;
  /** Days since pitch (or creation if not yet pitched). Computed in the lib for UI use. */
  ageDays: number;
}

interface PressTouchRow extends RowDataPacket {
  touch_id: number;
  client_id: number;
  journalist_name: string;
  journalist_email: string | null;
  outlet: string;
  beat: string | null;
  channel: PressTouchChannel;
  status: PressTouchStatus;
  subject_line: string | null;
  notes: string | null;
  related_lead_id: number | null;
  related_brief_key: string | null;
  url: string | null;
  created_by_user_id: number | null;
  created_at: string;
  pitched_at: string | null;
  replied_at: string | null;
  published_at: string | null;
}

function ageDays(start: string | null): number {
  if (!start) return 0;
  const t = new Date(start).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function rowToTouch(r: PressTouchRow): PressTouch {
  return {
    id: r.touch_id,
    clientId: r.client_id,
    journalist: r.journalist_name,
    journalistEmail: r.journalist_email,
    outlet: r.outlet,
    beat: r.beat,
    channel: r.channel,
    status: r.status,
    subject: r.subject_line,
    notes: r.notes,
    relatedLeadId: r.related_lead_id,
    relatedBriefKey: r.related_brief_key,
    url: r.url,
    createdByUserId: r.created_by_user_id,
    createdAt: r.created_at,
    pitchedAt: r.pitched_at,
    repliedAt: r.replied_at,
    publishedAt: r.published_at,
    ageDays: ageDays(r.pitched_at ?? r.created_at)
  };
}

/**
 * Latest N press touches for a brand. Returns [] on any miss or schema-absent
 * DB so the dashboard never errors.
 */
export async function listPressTouches(clientId: number, limit = 8): Promise<PressTouch[]> {
  if (!Number.isInteger(clientId) || clientId <= 0) return [];
  const lim = Math.max(1, Math.min(50, Math.floor(limit)));
  try {
    const db = getAvDb();
    const [rows] = await db.execute<PressTouchRow[]>(
      `SELECT touch_id, client_id, journalist_name, journalist_email, outlet, beat,
              channel, status, subject_line, notes, related_lead_id, related_brief_key,
              url, created_by_user_id, created_at, pitched_at, replied_at, published_at
         FROM press_touches
        WHERE client_id = ?
        ORDER BY COALESCE(pitched_at, created_at) DESC
        LIMIT ${lim}`,
      [clientId]
    );
    return rows.map(rowToTouch);
  } catch (err) {
    console.error('[press_touches:list]', clientId, (err as Error).message);
    return [];
  }
}

/**
 * Count of touches in the last 7 days for the dashboard metric chip.
 * Returns 0 on any miss.
 */
export async function countPressTouchesThisWeek(clientId: number): Promise<number> {
  if (!Number.isInteger(clientId) || clientId <= 0) return 0;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { n: number })[]>(
      `SELECT COUNT(*) AS n FROM press_touches
        WHERE client_id = ?
          AND COALESCE(pitched_at, created_at) >= NOW() - INTERVAL 7 DAY`,
      [clientId]
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Aggregate status counts for the operator press surface header.
 */
export async function getPressTouchStatusSummary(clientId: number): Promise<Record<PressTouchStatus, number>> {
  const empty: Record<PressTouchStatus, number> = {
    drafted: 0, pitched: 0, replied: 0, published: 0, declined: 0, no_response: 0
  };
  if (!Number.isInteger(clientId) || clientId <= 0) return empty;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { status: PressTouchStatus; n: number })[]>(
      `SELECT status, COUNT(*) AS n FROM press_touches WHERE client_id = ? GROUP BY status`,
      [clientId]
    );
    const out = { ...empty };
    for (const r of rows) {
      if (r.status in out) out[r.status] = Number(r.n);
    }
    return out;
  } catch {
    return empty;
  }
}

export interface LogPressTouchInput {
  clientId: number;
  journalist: string;
  outlet: string;
  beat?: string | null;
  journalistEmail?: string | null;
  channel?: PressTouchChannel;
  status?: PressTouchStatus;
  subject?: string | null;
  notes?: string | null;
  relatedLeadId?: number | null;
  relatedBriefKey?: string | null;
  createdByUserId?: number | null;
}

/**
 * Insert a new press touch. Returns the new touch_id, or 0 on schema-absent DB.
 * Sets pitched_at automatically if status='pitched' (or later).
 */
export async function logPressTouch(input: LogPressTouchInput): Promise<number> {
  const status: PressTouchStatus = input.status ?? 'drafted';
  const channel: PressTouchChannel = input.channel ?? 'email';
  const setPitched = ['pitched', 'replied', 'published', 'declined', 'no_response'].includes(status);
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO press_touches
         (client_id, journalist_name, journalist_email, outlet, beat, channel, status,
          subject_line, notes, related_lead_id, related_brief_key, created_by_user_id,
          pitched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${setPitched ? 'NOW()' : 'NULL'})`,
      [
        input.clientId,
        input.journalist.trim(),
        input.journalistEmail?.trim() || null,
        input.outlet.trim(),
        input.beat?.trim() || null,
        channel,
        status,
        input.subject?.trim() || null,
        input.notes?.trim() || null,
        input.relatedLeadId ?? null,
        input.relatedBriefKey ?? null,
        input.createdByUserId ?? null
      ]
    );
    return res.insertId ?? 0;
  } catch (err) {
    console.error('[press_touches:log]', (err as Error).message);
    return 0;
  }
}

/**
 * Advance the status of an existing touch. If transitioning to 'pitched' /
 * 'replied' / 'published', stamps the corresponding *_at column with NOW().
 * Optionally accepts a published URL when the status moves to 'published'.
 */
export async function updatePressTouchStatus(
  touchId: number,
  status: PressTouchStatus,
  url?: string | null
): Promise<boolean> {
  if (!Number.isInteger(touchId) || touchId <= 0) return false;
  const sets: string[] = ['status = ?'];
  const params: unknown[] = [status];
  if (['pitched', 'replied', 'published', 'declined', 'no_response'].includes(status)) {
    sets.push('pitched_at = COALESCE(pitched_at, NOW())');
  }
  if (status === 'replied') sets.push('replied_at = COALESCE(replied_at, NOW())');
  if (status === 'published') {
    sets.push('published_at = COALESCE(published_at, NOW())');
    if (typeof url === 'string' && url.trim()) {
      sets.push('url = ?');
      params.push(url.trim());
    }
  }
  params.push(touchId);
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE press_touches SET ${sets.join(', ')} WHERE touch_id = ?`,
      params
    );
    return (res.affectedRows ?? 0) > 0;
  } catch (err) {
    console.error('[press_touches:updateStatus]', (err as Error).message);
    return false;
  }
}
