/**
 * lib/campaigns/line_links.ts
 *
 * The narrative spine's memory map (schema 050). Link any asset to a narrative
 * line with a ROLE — advances / reinforces / tests — and read it back so the
 * cockpit (and, later, the learning loop) can see which assets serve which story.
 *
 * Fails soft: linking never throws into a generation flow (auto-link is a
 * non-fatal side effect). Reads degrade to empty on error.
 */
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export type LinkAssetType =
  | 'content_artifact'
  | 'commercial'
  | 'social_post'
  | 'pr_pitch'
  | 'press_release'
  | 'lead'
  | 'campaign';

export type LinkRole = 'advances' | 'reinforces' | 'tests';

export const LINK_ROLES: LinkRole[] = ['advances', 'reinforces', 'tests'];

export interface LineLink {
  id: number;
  narrativeLineId: number;
  assetType: LinkAssetType;
  assetId: number;
  role: LinkRole;
  note: string | null;
  createdAt: string;
}

export interface RoleCounts {
  advances: number;
  reinforces: number;
  tests: number;
  total: number;
}

function isRole(v: unknown): v is LinkRole {
  return v === 'advances' || v === 'reinforces' || v === 'tests';
}

/**
 * Link (or re-role) an asset to a narrative line. Idempotent on
 * (narrative_line_id, asset_type, asset_id): a second call updates the role.
 * Returns true on success; never throws.
 */
export async function linkAssetToLine(args: {
  tenantId: string;
  narrativeLineId: number;
  assetType: LinkAssetType;
  assetId: number;
  role?: LinkRole;
  note?: string | null;
  createdByUserId?: number | null;
}): Promise<boolean> {
  if (!Number.isInteger(args.narrativeLineId) || args.narrativeLineId <= 0) return false;
  if (!Number.isInteger(args.assetId) || args.assetId <= 0) return false;
  const role: LinkRole = isRole(args.role) ? args.role : 'advances';
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `INSERT INTO narrative_line_links
         (tenant_id, narrative_line_id, asset_type, asset_id, role, note, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE role = VALUES(role), note = VALUES(note), updated_at = NOW()`,
      [args.tenantId, args.narrativeLineId, args.assetType, args.assetId, role, args.note ?? null, args.createdByUserId ?? null]
    );
    await logEvent({
      eventType: 'content.line_linked',
      source: 'narrative_spine',
      payload: { narrative_line_id: args.narrativeLineId, asset_type: args.assetType, asset_id: args.assetId, role }
    }).catch(() => {});
    return true;
  } catch (err) {
    console.error('[line_links:link]', (err as Error).message);
    return false;
  }
}

export async function unlinkAssetFromLine(narrativeLineId: number, assetType: LinkAssetType, assetId: number): Promise<boolean> {
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `DELETE FROM narrative_line_links WHERE narrative_line_id = ? AND asset_type = ? AND asset_id = ?`,
      [narrativeLineId, assetType, assetId]
    );
    return true;
  } catch (err) {
    console.error('[line_links:unlink]', (err as Error).message);
    return false;
  }
}

export async function listLinksForLine(narrativeLineId: number): Promise<LineLink[]> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & {
      id: number; narrative_line_id: number; asset_type: LinkAssetType; asset_id: number; role: LinkRole; note: string | null; created_at: string;
    })[]>(
      `SELECT id, narrative_line_id, asset_type, asset_id, role, note, created_at
         FROM narrative_line_links
        WHERE narrative_line_id = ?
        ORDER BY FIELD(role,'advances','reinforces','tests'), created_at DESC
        LIMIT 200`,
      [narrativeLineId]
    );
    return rows.map((r) => ({
      id: r.id,
      narrativeLineId: r.narrative_line_id,
      assetType: r.asset_type,
      assetId: r.asset_id,
      role: r.role,
      note: r.note,
      createdAt: String(r.created_at)
    }));
  } catch {
    return [];
  }
}

/** Role counts for one line (for the cockpit story-map badges). */
export async function roleCountsForLine(narrativeLineId: number): Promise<RoleCounts> {
  const empty: RoleCounts = { advances: 0, reinforces: 0, tests: 0, total: 0 };
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { role: LinkRole; n: number | string })[]>(
      `SELECT role, COUNT(*) AS n FROM narrative_line_links WHERE narrative_line_id = ? GROUP BY role`,
      [narrativeLineId]
    );
    const out = { ...empty };
    for (const r of rows) {
      const n = Number(r.n) || 0;
      if (isRole(r.role)) out[r.role] = n;
      out.total += n;
    }
    return out;
  } catch {
    return empty;
  }
}

/** Role counts for many lines at once (one query) — keyed by line id. */
export async function roleCountsForLines(lineIds: number[]): Promise<Record<number, RoleCounts>> {
  const result: Record<number, RoleCounts> = {};
  const ids = lineIds.filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return result;
  for (const id of ids) result[id] = { advances: 0, reinforces: 0, tests: 0, total: 0 };
  try {
    const db = getAvDb();
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.execute<(RowDataPacket & { narrative_line_id: number; role: LinkRole; n: number | string })[]>(
      `SELECT narrative_line_id, role, COUNT(*) AS n
         FROM narrative_line_links
        WHERE narrative_line_id IN (${placeholders})
        GROUP BY narrative_line_id, role`,
      ids
    );
    for (const r of rows) {
      const bucket = result[r.narrative_line_id];
      if (!bucket) continue;
      const n = Number(r.n) || 0;
      if (isRole(r.role)) bucket[r.role] = n;
      bucket.total += n;
    }
  } catch {
    /* return zeros */
  }
  return result;
}
