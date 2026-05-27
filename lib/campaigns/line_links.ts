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

/**
 * The customer's PRIMARY active narrative line id (sort_order first), or null.
 * Scoped by (tenant, clientId) — clientId null = the brand's own house lines.
 * Own small query (not importing the campaigns store) to avoid a circular dep.
 */
async function primaryActiveLineId(tenantId: string, clientId: number | null): Promise<number | null> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM narrative_lanes
        WHERE tenant_id = ? AND client_id <=> ? AND archived_at IS NULL
          AND state IN ('active','reinforcing')
        ORDER BY sort_order ASC, name ASC
        LIMIT 1`,
      [tenantId, clientId]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error('[line_links:primaryActive]', (err as Error).message);
    return null;
  }
}

/** The client_id that owns a lead (null = operator/house prospect). */
async function clientIdForLead(leadId: number): Promise<number | null> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { client_id: number | null })[]>(
      `SELECT client_id FROM leads WHERE id = ? LIMIT 1`,
      [leadId]
    );
    return rows[0]?.client_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Auto-thread a freshly created asset to the customer's primary ACTIVE narrative
 * line, so every channel reinforces one story ("one story everywhere"). No-op
 * (returns false) when the customer has no active line yet. Never throws — safe
 * to fire-and-forget from any generation flow. Idempotent via linkAssetToLine.
 *
 * Pass `clientId` directly, OR pass `leadId` and we resolve the owner: a lead
 * owned by a client threads to THAT client's line; a prospect (client_id NULL)
 * threads to the brand's own house line. Content reinforces the right story.
 */
export async function autoThreadAsset(args: {
  tenantId: string;
  clientId?: number | null;
  leadId?: number | null;
  assetType: LinkAssetType;
  assetId: number;
  role?: LinkRole;
  note?: string | null;
}): Promise<boolean> {
  if (!Number.isInteger(args.assetId) || args.assetId <= 0) return false;
  let clientId = args.clientId ?? null;
  if (clientId == null && args.leadId != null && args.leadId > 0) {
    clientId = await clientIdForLead(args.leadId);
  }
  const lineId = await primaryActiveLineId(args.tenantId, clientId);
  if (!lineId) return false;
  return linkAssetToLine({
    tenantId: args.tenantId,
    narrativeLineId: lineId,
    assetType: args.assetType,
    assetId: args.assetId,
    role: args.role ?? 'advances',
    note: args.note ?? 'auto-threaded on create'
  });
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

/**
 * A written/queued asset a line has PRODUCED, resolved for display in the cockpit
 * "What this story has produced" rollup. Covers content_artifact / social_post /
 * pr_pitch / press_release — NOT commercials (those have their own gallery) or
 * lead/campaign links. Read-only; degrades to [] on error.
 */
export interface LineProducedAsset {
  linkId: number;
  assetType: 'content_artifact' | 'social_post' | 'pr_pitch' | 'press_release';
  assetId: number;
  role: LinkRole;
  /** Short human label: a title, or a snippet of the body. */
  label: string;
  /** Asset lifecycle (draft / scheduled / published / approved …) when known. */
  status: string | null;
  /** A friendly kind label for the chip ("Post", "Blog", "Pitch", "Release"). */
  kind: string;
  createdAt: string;
}

const PRODUCED_TYPES = new Set(['content_artifact', 'social_post', 'pr_pitch', 'press_release']);

function snippet(s: string | null | undefined, max = 90): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

export async function listLineProducedAssets(narrativeLineId: number): Promise<LineProducedAsset[]> {
  if (!Number.isInteger(narrativeLineId) || narrativeLineId <= 0) return [];
  const links = (await listLinksForLine(narrativeLineId)).filter((l) => PRODUCED_TYPES.has(l.assetType));
  if (links.length === 0) return [];

  // Bucket the asset ids by type so we resolve each table in one query.
  const byType: Record<string, number[]> = {};
  for (const l of links) (byType[l.assetType] ??= []).push(l.assetId);

  // Per-asset display detail, keyed `${assetType}:${assetId}`.
  const detail = new Map<string, { label: string; status: string | null; kind: string }>();
  const db = getAvDb();
  const inList = (ids: number[]) => ids.map(() => '?').join(',');

  try {
    if (byType.content_artifact?.length) {
      const ids = byType.content_artifact;
      const [rows] = await db.execute<(RowDataPacket & { id: number; artifact_type: string; title: string | null; body_text: string | null; status: string | null })[]>(
        `SELECT id, artifact_type, title, body_text, status FROM content_artifacts WHERE id IN (${inList(ids)})`,
        ids
      );
      for (const r of rows) {
        const kind = r.artifact_type === 'own_brand_post' ? 'Post'
          : r.artifact_type === 'blog_article' ? 'Blog'
          : r.artifact_type === 'seo_article' ? 'SEO article'
          : r.artifact_type === 'press_release' ? 'Release'
          : 'Content';
        detail.set(`content_artifact:${r.id}`, { label: r.title?.trim() || snippet(r.body_text) || `Content #${r.id}`, status: r.status, kind });
      }
    }
    if (byType.social_post?.length) {
      const ids = byType.social_post;
      const [rows] = await db.execute<(RowDataPacket & { id: number; body_text: string | null; status: string | null })[]>(
        `SELECT id, body_text, status FROM social_outbox WHERE id IN (${inList(ids)})`,
        ids
      );
      for (const r of rows) detail.set(`social_post:${r.id}`, { label: snippet(r.body_text) || `Post #${r.id}`, status: r.status, kind: 'Post' });
    }
    if (byType.pr_pitch?.length) {
      const ids = byType.pr_pitch;
      const [rows] = await db.execute<(RowDataPacket & { id: number; body_text: string | null; status: string | null })[]>(
        `SELECT id, body_text, status FROM pr_pitches WHERE id IN (${inList(ids)})`,
        ids
      );
      for (const r of rows) detail.set(`pr_pitch:${r.id}`, { label: snippet(r.body_text) || `Pitch #${r.id}`, status: r.status, kind: 'Pitch' });
    }
    if (byType.press_release?.length) {
      const ids = byType.press_release;
      const [rows] = await db.execute<(RowDataPacket & { id: number; title: string | null; body_text: string | null; status: string | null })[]>(
        `SELECT id, title, body_text, status FROM press_releases WHERE id IN (${inList(ids)})`,
        ids
      );
      for (const r of rows) detail.set(`press_release:${r.id}`, { label: r.title?.trim() || snippet(r.body_text) || `Release #${r.id}`, status: r.status, kind: 'Release' });
    }
  } catch (err) {
    console.error('[line_links:produced]', (err as Error).message);
    return [];
  }

  // Preserve the link ordering (role, then recency) from listLinksForLine.
  const out: LineProducedAsset[] = [];
  for (const l of links) {
    const d = detail.get(`${l.assetType}:${l.assetId}`);
    if (!d) continue; // asset deleted/archived — skip the dangling link
    out.push({
      linkId: l.id,
      assetType: l.assetType as LineProducedAsset['assetType'],
      assetId: l.assetId,
      role: l.role,
      label: d.label,
      status: d.status,
      kind: d.kind,
      createdAt: l.createdAt
    });
  }
  return out;
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
