/**
 * lib/social/publishing_control.ts
 *
 * "Stop the presses" — the global publish kill-switch. A single row
 * (publishing_control id=1) in the AV DB, read FRESH on every publish attempt
 * (publishing is infrequent, so the extra cheap SELECT is worth instant
 * enforcement — no caching/propagation delay like feature_flags).
 *
 * Enforced in lib/social/publish.publishOutboxRow (manual single + bulk) and at
 * the top of /api/admin/social/publish-due (the cron), before any rows are
 * claimed. Toggled by owner/staff (e.g. Rebecca, CFO) via
 * /api/admin/social/publishing-pause.
 */
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export interface PublishingPause {
  paused: boolean;
  reason: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface ControlRow extends RowDataPacket {
  paused: number;
  reason: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

export async function getPublishingPause(): Promise<PublishingPause> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<ControlRow[]>(
      `SELECT paused, reason, updated_by, updated_at FROM publishing_control WHERE id = 1 LIMIT 1`
    );
    const r = rows[0];
    return {
      paused: !!r && Number(r.paused) === 1,
      reason: r?.reason ?? null,
      updatedBy: r?.updated_by ?? null,
      updatedAt: r?.updated_at ? String(r.updated_at) : null
    };
  } catch {
    // Fail OPEN: a transient DB blip should not silently halt the business.
    // (If the DB is truly down, the publish path fails on its own row fetch.)
    return { paused: false, reason: null, updatedBy: null, updatedAt: null };
  }
}

export async function setPublishingPause(
  paused: boolean,
  reason: string | null,
  updatedBy: string | null
): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `INSERT INTO publishing_control (id, paused, reason, updated_by, updated_at)
       VALUES (1, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       paused = VALUES(paused), reason = VALUES(reason),
       updated_by = VALUES(updated_by), updated_at = NOW()`,
    [paused ? 1 : 0, reason?.slice(0, 280) ?? null, updatedBy?.slice(0, 190) ?? null]
  );
}
