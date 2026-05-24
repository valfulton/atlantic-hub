/**
 * lib/campaigns/engagement.ts
 *
 * The learning loop, step one: attribute engagement to a narrative line.
 *
 * Today the numbers are entered MANUALLY (recordEngagement, source='manual') so
 * we start capturing real signal immediately, without waiting on platform APIs.
 * When the social post-target work (task #45) lands, pullEngagementFromSocials()
 * will fetch the same numbers automatically and write rows with source='pull' —
 * same table, same rollup, so nothing downstream changes. Until then it returns
 * a clear "not connected yet" so the UI can keep the manual path in front.
 *
 * See schema/039_narrative_line_engagement.sql.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const DEFAULT_TENANT = 'av';

export type EngagementChannel =
  | 'linkedin' | 'facebook' | 'instagram' | 'blog' | 'newsroom' | 'email' | 'other';

const VALID_CHANNELS: EngagementChannel[] = ['linkedin', 'facebook', 'instagram', 'blog', 'newsroom', 'email', 'other'];

export function normalizeChannel(v: unknown): EngagementChannel {
  return typeof v === 'string' && VALID_CHANNELS.includes(v as EngagementChannel) ? (v as EngagementChannel) : 'other';
}

export interface EngagementEntryInput {
  tenantId?: string;
  narrativeLineId: number;
  campaignId?: number | null;
  channel: EngagementChannel;
  periodStart?: string | null; // 'YYYY-MM-DD'
  periodEnd?: string | null;
  impressions?: number;
  engagements?: number;
  clicks?: number;
  conversions?: number;
  note?: string | null;
  userId?: number | null;
}

const int = (v: unknown): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const dateOrNull = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;

/** Record one manual engagement reading for a line. Returns the new row id. */
export async function recordEngagement(input: EngagementEntryInput): Promise<number> {
  const lineId = Math.trunc(Number(input.narrativeLineId));
  if (!Number.isInteger(lineId) || lineId <= 0) throw new Error('narrativeLineId required');
  const db = getAvDb();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO narrative_line_engagement
       (tenant_id, narrative_line_id, campaign_id, channel, period_start, period_end,
        impressions, engagements, clicks, conversions, source, note, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
    [
      input.tenantId || DEFAULT_TENANT,
      lineId,
      input.campaignId && input.campaignId > 0 ? input.campaignId : null,
      normalizeChannel(input.channel),
      dateOrNull(input.periodStart),
      dateOrNull(input.periodEnd),
      int(input.impressions), int(input.engagements), int(input.clicks), int(input.conversions),
      input.note ? String(input.note).slice(0, 500) : null,
      input.userId ?? null
    ]
  );
  return res.insertId;
}

export interface EngagementSummary {
  lineId: number;
  impressions: number;
  engagements: number;
  clicks: number;
  conversions: number;
  entryCount: number;
  /** engagements / impressions, 0..1 (0 when no impressions). */
  engagementRate: number;
  byChannel: Array<{ channel: string; impressions: number; engagements: number; clicks: number; conversions: number }>;
  recent: Array<{
    id: number; channel: string; periodStart: string | null; periodEnd: string | null;
    impressions: number; engagements: number; clicks: number; conversions: number;
    source: 'manual' | 'pull'; note: string | null; createdAt: string;
  }>;
}

/** Roll up everything attributed to a line. PURE DATA — no API cost. */
export async function getLineEngagementSummary(lineId: number): Promise<EngagementSummary> {
  const db = getAvDb();
  const empty: EngagementSummary = {
    lineId, impressions: 0, engagements: 0, clicks: 0, conversions: 0,
    entryCount: 0, engagementRate: 0, byChannel: [], recent: []
  };
  if (!Number.isInteger(lineId) || lineId <= 0) return empty;

  const [totals] = await db.execute<(RowDataPacket & {
    impressions: number; engagements: number; clicks: number; conversions: number; n: number;
  })[]>(
    `SELECT COALESCE(SUM(impressions),0) AS impressions, COALESCE(SUM(engagements),0) AS engagements,
            COALESCE(SUM(clicks),0) AS clicks, COALESCE(SUM(conversions),0) AS conversions, COUNT(*) AS n
       FROM narrative_line_engagement WHERE narrative_line_id = ?`,
    [lineId]
  );
  const t = totals[0];
  if (!t || Number(t.n) === 0) return empty;

  const [chan] = await db.execute<(RowDataPacket & {
    channel: string; impressions: number; engagements: number; clicks: number; conversions: number;
  })[]>(
    `SELECT channel, SUM(impressions) AS impressions, SUM(engagements) AS engagements,
            SUM(clicks) AS clicks, SUM(conversions) AS conversions
       FROM narrative_line_engagement WHERE narrative_line_id = ?
      GROUP BY channel ORDER BY SUM(impressions) DESC`,
    [lineId]
  );
  const [recent] = await db.execute<(RowDataPacket & {
    id: number; channel: string; period_start: string | null; period_end: string | null;
    impressions: number; engagements: number; clicks: number; conversions: number;
    source: 'manual' | 'pull'; note: string | null; created_at: string;
  })[]>(
    `SELECT id, channel, period_start, period_end, impressions, engagements, clicks, conversions, source, note, created_at
       FROM narrative_line_engagement WHERE narrative_line_id = ?
      ORDER BY created_at DESC LIMIT 20`,
    [lineId]
  );

  const impressions = Number(t.impressions) || 0;
  const engagements = Number(t.engagements) || 0;
  return {
    lineId,
    impressions,
    engagements,
    clicks: Number(t.clicks) || 0,
    conversions: Number(t.conversions) || 0,
    entryCount: Number(t.n) || 0,
    engagementRate: impressions > 0 ? engagements / impressions : 0,
    byChannel: chan.map((c) => ({
      channel: c.channel,
      impressions: Number(c.impressions) || 0,
      engagements: Number(c.engagements) || 0,
      clicks: Number(c.clicks) || 0,
      conversions: Number(c.conversions) || 0
    })),
    recent: recent.map((r) => ({
      id: r.id, channel: r.channel, periodStart: r.period_start, periodEnd: r.period_end,
      impressions: Number(r.impressions) || 0, engagements: Number(r.engagements) || 0,
      clicks: Number(r.clicks) || 0, conversions: Number(r.conversions) || 0,
      source: r.source, note: r.note, createdAt: r.created_at
    }))
  };
}

export interface PullResult {
  ok: boolean;
  pulled: number;
  /** Operator-facing reason when not yet connected. */
  message: string;
}

/**
 * Pull engagement straight from the connected social accounts.
 *
 * STUB until the social post-target layer (task #45) gives us authenticated
 * per-platform accounts + stats scopes. Wiring point is intentionally here: when
 * #45 lands, fetch each platform's stats for this line's posts and call
 * recordEngagement(...) with source='pull'. Returns ok:false today so the UI
 * keeps the manual entry path in front and tells the operator why.
 */
export async function pullEngagementFromSocials(_lineId: number): Promise<PullResult> {
  return {
    ok: false,
    pulled: 0,
    message: 'Auto-pull from socials isn’t connected yet — it turns on with the social accounts work. Enter the numbers manually for now and they’ll roll up the same way.'
  };
}
