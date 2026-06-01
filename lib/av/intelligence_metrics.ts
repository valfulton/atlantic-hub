/**
 * lib/av/intelligence_metrics.ts  (#321 — Intelligence Trifecta)
 *
 * The operator metric chain that proves the Revenue Intelligence OS claim:
 *
 *     Intelligence Created  →  Intelligence Activated  →  Revenue Influenced
 *
 * Not "posts shipped" or "AI calls." The chain an investor cares about: how
 * much reusable intelligence the system discovered, how much of it actually
 * reached a channel, and how much revenue motion that intelligence is tied to.
 * See Atlantic_Hub_Playbook/HANDOFF_Intelligence_Trifecta.md +
 * memory project_revenue_intelligence_directive / feedback_visibility_gap.
 *
 * Pure aggregation. No writes. Every function takes optional `clientId`
 * (per-client) or returns operator-wide AV totals, plus `sinceDays` (default
 * 30) for the window. `trendVsPrior` compares the window to the immediately
 * preceding window of equal length.
 *
 * SCOPING MODEL (ground-truthed against the real schema, 2026-06-01):
 *   - intelligence_objects is keyed by tenant_id VARCHAR, NOT client_id.
 *     Operator/AV intel lives under tenant_id='av'; per-client intel under
 *     tenant_id='client:<clientId>' (and sometimes 'client:<memberUserId>')
 *     — same convention lib/client/intel_inventory.ts resolves.
 *   - narrative_lanes carries tenant_id='av' + nullable client_id.
 *   - pr_opportunities carries tenant_id; per-client via matched_lead_id→leads.
 *   - outreach/social/commercials/call_log scope through leads.client_id.
 *
 * ATTRIBUTION (the `attribution` field on revenueInfluenced) is a STUB until
 * the lineage graph (#322) ships derived_from / activated_in. We expose what
 * narrative_line_links already proves (narrative line → asset) as partial
 * evidence; full revenue-object attribution swaps in when lineage lands.
 */
import { getAvDb } from '@/lib/db/av';
import { DEFAULT_TENANT } from '@/lib/pr/types';
import type { Pool } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

export const AV_TENANT = DEFAULT_TENANT; // 'av'

// intelligence_objects.object_type buckets → the three "created" categories the
// dashboard headlines. Kept in sync with INTEL_OBJECT_CONSUMERS registry.
const AUTHORITY_TYPES = ['authority_topics', 'media_friendly_topics', 'preferred_narrative_angles'];
const ICP_TYPES = ['market_positioning', 'audience_psychology', 'competitive_weaknesses', 'differentiators', 'authority_positioning'];
const CONVERSION_TYPES = ['proof_points', 'engagement_patterns', 'founder_story', 'seasonal_opportunities'];

export interface MetricArgs {
  clientId?: number;
  sinceDays?: number;
}

export interface IntelligenceCreated {
  narrativeLines: number;
  authorityTopics: number;
  prOpportunities: number;
  icpPatterns: number;
  conversionInsights: number;
  total: number;
  trendVsPrior: number; // % change vs prior equal window (e.g. 23 = +23%)
}

export interface IntelligenceActivated {
  activatedInPR: number;
  activatedInOutreach: number;
  activatedInCommercials: number;
  activatedInSocial: number;
  activatedInSalesCalls: number;
  totalActivated: number;
  activationRate: number; // 0–1, totalActivated / created (clamped)
  trendVsPrior: number;
}

export interface RevenueInfluenced {
  meetingsBooked: number;
  proposalsSent: number;
  opportunitiesCreated: number;
  dealsClosedWon: number;
  dealsClosedLost: number;
  dollarValueClosed: number; // dollars, not cents
  /** STUB until lineage #322 — partial evidence from narrative_line_links. */
  attribution: Array<{ narrativeLineId: number; narrativeLine: string; activatedAssets: number }>;
  trendVsPrior: number;
}

export interface TrifectaSparkPoint {
  date: string; // YYYY-MM-DD
  created: number;
  activated: number;
  revenue: number;
}

export interface IntelligenceTrifecta {
  clientId: number | null;
  clientName: string | null;
  sinceDays: number;
  created: IntelligenceCreated;
  activated: IntelligenceActivated;
  revenue: RevenueInfluenced;
  series: TrifectaSparkPoint[];
  generatedAt: string;
}

function pctChange(current: number, prior: number): number {
  if (prior <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - prior) / prior) * 100);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Per-client intelligence_objects live under a tenant string, not a numeric
 * column. Mirror intel_inventory: try 'client:<clientId>' and the owning
 * client_user id. Resolve once, reuse across the three queries.
 */
async function resolveClientTenants(db: Pool, clientId: number): Promise<string[]> {
  const tenants = new Set<string>([`client:${clientId}`]);
  const [rows] = await db.execute<(RowDataPacket & { client_user_id: number })[]>(
    `SELECT client_user_id FROM client_users WHERE client_id = ? ORDER BY client_user_id ASC LIMIT 1`,
    [clientId]
  );
  let memberUserId = rows[0]?.client_user_id ?? null;
  if (!memberUserId) {
    const [orows] = await db.execute<(RowDataPacket & { client_user_id: number })[]>(
      `SELECT client_user_id FROM brand_members WHERE client_id = ? AND role = 'owner' ORDER BY client_user_id ASC LIMIT 1`,
      [clientId]
    );
    memberUserId = orows[0]?.client_user_id ?? null;
  }
  if (memberUserId) tenants.add(`client:${memberUserId}`);
  return [...tenants];
}

interface Scope {
  /** tenant_id values for intelligence_objects + narrative_lanes (intel side). */
  intelTenants: string[];
  clientId: number | null;
}

async function buildScope(db: Pool, clientId?: number): Promise<Scope> {
  if (clientId && clientId > 0) {
    const tenants = await resolveClientTenants(db, clientId);
    return { intelTenants: tenants, clientId };
  }
  return { intelTenants: [AV_TENANT], clientId: null };
}

/**
 * INTELLIGENCE CREATED — reusable intelligence the system discovered in window.
 */
export async function intelligenceCreated(args: MetricArgs = {}, dbArg?: Pool): Promise<IntelligenceCreated> {
  const db = dbArg ?? getAvDb();
  const sinceDays = args.sinceDays ?? 30;
  const scope = await buildScope(db, args.clientId);

  // intelligence_objects, bucketed by object_type, current + prior window.
  // Operator-wide ("All clients") spans tenant 'av' + every 'client:%' tenant.
  const tenantFilter = scope.clientId
    ? `tenant_id IN (${scope.intelTenants.map(() => '?').join(',')})`
    : `(tenant_id = ? OR tenant_id LIKE 'client:%')`;
  const tenantParams = scope.clientId ? scope.intelTenants : [AV_TENANT];

  const bucketCase = (types: string[]) =>
    `SUM(CASE WHEN object_type IN (${types.map(() => '?').join(',')}) THEN 1 ELSE 0 END)`;

  const [ioRows] = await db.execute<(RowDataPacket & {
    authority_cur: number; icp_cur: number; conv_cur: number;
    authority_prior: number; icp_prior: number; conv_prior: number;
  })[]>(
    `SELECT
       ${bucketCase(AUTHORITY_TYPES)} AS authority_cur,
       ${bucketCase(ICP_TYPES)} AS icp_cur,
       ${bucketCase(CONVERSION_TYPES)} AS conv_cur,
       0 AS authority_prior, 0 AS icp_prior, 0 AS conv_prior
     FROM intelligence_objects
     WHERE ${tenantFilter}
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [...AUTHORITY_TYPES, ...ICP_TYPES, ...CONVERSION_TYPES, ...tenantParams, sinceDays]
  );
  const [ioPrior] = await db.execute<(RowDataPacket & { authority_prior: number; icp_prior: number; conv_prior: number })[]>(
    `SELECT
       ${bucketCase(AUTHORITY_TYPES)} AS authority_prior,
       ${bucketCase(ICP_TYPES)} AS icp_prior,
       ${bucketCase(CONVERSION_TYPES)} AS conv_prior
     FROM intelligence_objects
     WHERE ${tenantFilter}
       AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [...AUTHORITY_TYPES, ...ICP_TYPES, ...CONVERSION_TYPES, ...tenantParams, sinceDays * 2, sinceDays]
  );

  // narrative_lanes — tenant 'av' (+ optional client_id filter).
  const laneClient = scope.clientId ? ` AND client_id = ${scope.clientId}` : '';
  const [laneRows] = await db.execute<(RowDataPacket & { cur: number; prior: number })[]>(
    `SELECT
       SUM(created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS cur,
       SUM(created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)) AS prior
     FROM narrative_lanes
     WHERE tenant_id = ? AND archived_at IS NULL${laneClient}`,
    [sinceDays, sinceDays * 2, sinceDays, AV_TENANT]
  );

  // pr_opportunities — tenant 'av'; per-client via matched lead.
  const prJoin = scope.clientId
    ? `JOIN leads l ON p.matched_lead_id = l.id AND l.client_id = ${scope.clientId}`
    : '';
  const [prRows] = await db.execute<(RowDataPacket & { cur: number; prior: number })[]>(
    `SELECT
       SUM(p.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS cur,
       SUM(p.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND p.created_at < DATE_SUB(NOW(), INTERVAL ? DAY)) AS prior
     FROM pr_opportunities p ${prJoin}
     WHERE p.tenant_id = ?`,
    [sinceDays, sinceDays * 2, sinceDays, AV_TENANT]
  );

  const authorityTopics = num(ioRows[0]?.authority_cur);
  const icpPatterns = num(ioRows[0]?.icp_cur);
  const conversionInsights = num(ioRows[0]?.conv_cur);
  const narrativeLines = num(laneRows[0]?.cur);
  const prOpportunities = num(prRows[0]?.cur);
  const total = authorityTopics + icpPatterns + conversionInsights + narrativeLines + prOpportunities;

  const priorTotal =
    num(ioPrior[0]?.authority_prior) + num(ioPrior[0]?.icp_prior) + num(ioPrior[0]?.conv_prior) +
    num(laneRows[0]?.prior) + num(prRows[0]?.prior);

  return {
    narrativeLines,
    authorityTopics,
    prOpportunities,
    icpPatterns,
    conversionInsights,
    total,
    trendVsPrior: pctChange(total, priorTotal)
  };
}

/**
 * INTELLIGENCE ACTIVATED — intelligence that actually reached a channel.
 * The bridge between "data lake" and "actually working."
 */
export async function intelligenceActivated(args: MetricArgs = {}, dbArg?: Pool): Promise<IntelligenceActivated> {
  const db = dbArg ?? getAvDb();
  const sinceDays = args.sinceDays ?? 30;
  const scope = await buildScope(db, args.clientId);
  const cid = scope.clientId;

  // Each lane: count current window + prior window in one round-trip.
  // PR: pitches that left draft (approved or sent), in the client's voice.
  const prClient = cid ? `JOIN leads l ON pp.lead_id = l.id AND l.client_id = ${cid}` : '';
  const [pr] = await db.execute<(RowDataPacket & { cur: number; prior: number })[]>(
    `SELECT
       SUM(pp.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS cur,
       SUM(pp.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND pp.updated_at < DATE_SUB(NOW(), INTERVAL ? DAY)) AS prior
     FROM pr_pitches pp ${prClient}
     WHERE pp.tenant_id = ? AND pp.status IN ('approved','sent')`,
    [sinceDays, sinceDays * 2, sinceDays, AV_TENANT]
  );

  // Outreach: messages sent AND grounded on the lead's audit (intel-driven).
  const outClient = cid ? `AND l.client_id = ${cid}` : '';
  const [out] = await db.execute<(RowDataPacket & { cur: number; prior: number })[]>(
    `SELECT
       SUM(m.sent_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS cur,
       SUM(m.sent_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND m.sent_at < DATE_SUB(NOW(), INTERVAL ? DAY)) AS prior
     FROM outreach_messages m
     JOIN leads l ON m.lead_id = l.id
     WHERE m.status = 'sent' AND m.ai_grounded_on_audit = 1 AND m.sent_at IS NOT NULL ${outClient}`,
    [sinceDays, sinceDays * 2, sinceDays]
  );

  // Commercials: produced video/image tied to a narrative line.
  const commClient = cid ? `JOIN leads l ON g.lead_id = l.id AND l.client_id = ${cid}` : '';
  const [comm] = await db.execute<(RowDataPacket & { cur: number; prior: number })[]>(
    `SELECT
       SUM(g.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS cur,
       SUM(g.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND g.created_at < DATE_SUB(NOW(), INTERVAL ? DAY)) AS prior
     FROM grok_imagine_assets g ${commClient}
     WHERE g.generation_status = 'succeeded' AND g.narrative_line_id IS NOT NULL`,
    [sinceDays, sinceDays * 2, sinceDays]
  );

  // Social: outbox items published. tenant 'av' + every client tenant when
  // operator-wide; per-client via the lead join.
  const socClient = cid ? `JOIN leads l ON s.lead_id = l.id AND l.client_id = ${cid}` : '';
  const socTenant = cid ? '' : `AND (s.tenant_id = ? OR s.tenant_id LIKE 'client:%')`;
  const socParams = cid ? [sinceDays, sinceDays * 2, sinceDays] : [sinceDays, sinceDays * 2, sinceDays, AV_TENANT];
  const [soc] = await db.execute<(RowDataPacket & { cur: number; prior: number })[]>(
    `SELECT
       SUM(s.published_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS cur,
       SUM(s.published_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND s.published_at < DATE_SUB(NOW(), INTERVAL ? DAY)) AS prior
     FROM social_outbox s ${socClient}
     WHERE s.status = 'published' AND s.published_at IS NOT NULL ${socTenant}`,
    socParams
  );

  // Sales calls: a connect/meeting where intel powered the script.
  const callClient = cid ? `AND l.client_id = ${cid}` : '';
  const [calls] = await db.execute<(RowDataPacket & { cur: number; prior: number })[]>(
    `SELECT
       SUM(cl.called_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS cur,
       SUM(cl.called_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND cl.called_at < DATE_SUB(NOW(), INTERVAL ? DAY)) AS prior
     FROM call_log cl
     JOIN leads l ON cl.lead_id = l.id
     WHERE cl.outcome IN ('connected','follow_up','meeting_booked','converted') ${callClient}`,
    [sinceDays, sinceDays * 2, sinceDays]
  );

  const activatedInPR = num(pr[0]?.cur);
  const activatedInOutreach = num(out[0]?.cur);
  const activatedInCommercials = num(comm[0]?.cur);
  const activatedInSocial = num(soc[0]?.cur);
  const activatedInSalesCalls = num(calls[0]?.cur);
  const totalActivated = activatedInPR + activatedInOutreach + activatedInCommercials + activatedInSocial + activatedInSalesCalls;

  const priorActivated =
    num(pr[0]?.prior) + num(out[0]?.prior) + num(comm[0]?.prior) + num(soc[0]?.prior) + num(calls[0]?.prior);

  // activationRate = activated ÷ created in the same window (clamped 0–1).
  const created = await intelligenceCreated({ clientId: args.clientId, sinceDays }, db);
  const activationRate = created.total > 0 ? Math.min(1, totalActivated / created.total) : 0;

  return {
    activatedInPR,
    activatedInOutreach,
    activatedInCommercials,
    activatedInSocial,
    activatedInSalesCalls,
    totalActivated,
    activationRate,
    trendVsPrior: pctChange(totalActivated, priorActivated)
  };
}

/**
 * REVENUE INFLUENCED — the revenue motion tied to activated intelligence.
 * Window keys off leads.last_activity_at (the closest progression timestamp).
 */
export async function revenueInfluenced(args: MetricArgs = {}, dbArg?: Pool): Promise<RevenueInfluenced> {
  const db = dbArg ?? getAvDb();
  const sinceDays = args.sinceDays ?? 30;
  const scope = await buildScope(db, args.clientId);
  const cid = scope.clientId;
  const leadClient = cid ? `AND l.client_id = ${cid}` : '';

  // Meetings booked — from call outcomes.
  const callClient = cid ? `AND l.client_id = ${cid}` : '';
  const [mtg] = await db.execute<(RowDataPacket & { cur: number; prior: number })[]>(
    `SELECT
       SUM(cl.called_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS cur,
       SUM(cl.called_at >= DATE_SUB(NOW(), INTERVAL ? DAY) AND cl.called_at < DATE_SUB(NOW(), INTERVAL ? DAY)) AS prior
     FROM call_log cl JOIN leads l ON cl.lead_id = l.id
     WHERE cl.outcome = 'meeting_booked' ${callClient}`,
    [sinceDays, sinceDays * 2, sinceDays]
  );

  // Proposals sent — distinct leads that received a sent outreach message.
  const [prop] = await db.execute<(RowDataPacket & { cur: number })[]>(
    `SELECT COUNT(DISTINCT m.lead_id) AS cur
     FROM outreach_messages m JOIN leads l ON m.lead_id = l.id
     WHERE m.status = 'sent' AND m.sent_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ${leadClient}`,
    [sinceDays]
  );

  // Pipeline progression — keyed on lead_status + last_activity window.
  const [lead] = await db.execute<(RowDataPacket & {
    opp_cur: number; won_cur: number; lost_cur: number; won_prior: number;
  })[]>(
    `SELECT
       SUM(l.lead_status = 'qualified' AND COALESCE(l.last_activity_at, l.updated_at) >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS opp_cur,
       SUM(l.lead_status = 'converted' AND COALESCE(l.last_activity_at, l.updated_at) >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS won_cur,
       SUM(l.lead_status = 'lost' AND COALESCE(l.last_activity_at, l.updated_at) >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS lost_cur,
       SUM(l.lead_status = 'converted' AND COALESCE(l.last_activity_at, l.updated_at) >= DATE_SUB(NOW(), INTERVAL ? DAY) AND COALESCE(l.last_activity_at, l.updated_at) < DATE_SUB(NOW(), INTERVAL ? DAY)) AS won_prior
     FROM leads l
     WHERE l.archived_at IS NULL ${leadClient}`,
    [sinceDays, sinceDays, sinceDays, sinceDays * 2, sinceDays]
  );

  // Dollar value of won deals in window (cents → dollars).
  const [dollars] = await db.execute<(RowDataPacket & { cents: number })[]>(
    `SELECT COALESCE(SUM(
        CASE WHEN c.deal_model = 'per_head' THEN COALESCE(l.deal_unit_count,0) * COALESCE(c.deal_rate_cents,0)
             WHEN c.deal_model = 'flat'     THEN COALESCE(l.deal_flat_cents,0)
             ELSE 0 END), 0) AS cents
     FROM leads l LEFT JOIN clients c ON l.client_id = c.client_id
     WHERE l.lead_status = 'converted' AND l.archived_at IS NULL
       AND COALESCE(l.last_activity_at, l.updated_at) >= DATE_SUB(NOW(), INTERVAL ? DAY) ${leadClient}`,
    [sinceDays]
  );

  // Attribution stub — narrative line → activated assets (via links). Full
  // revenue-object attribution lands with lineage #322.
  const attrClient = cid ? `AND nl.client_id = ${cid}` : '';
  const [attr] = await db.execute<(RowDataPacket & { narrative_line_id: number; name: string; cnt: number })[]>(
    `SELECT nll.narrative_line_id, nl.name, COUNT(*) AS cnt
     FROM narrative_line_links nll
     JOIN narrative_lanes nl ON nll.narrative_line_id = nl.id
     WHERE nll.tenant_id = ? ${attrClient}
       AND nll.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY nll.narrative_line_id, nl.name
     ORDER BY cnt DESC
     LIMIT 5`,
    [AV_TENANT, sinceDays]
  );

  const dealsClosedWon = num(lead[0]?.won_cur);
  return {
    meetingsBooked: num(mtg[0]?.cur),
    proposalsSent: num(prop[0]?.cur),
    opportunitiesCreated: num(lead[0]?.opp_cur),
    dealsClosedWon,
    dealsClosedLost: num(lead[0]?.lost_cur),
    dollarValueClosed: Math.round(num(dollars[0]?.cents) / 100),
    attribution: attr.map((r) => ({
      narrativeLineId: r.narrative_line_id,
      narrativeLine: r.name,
      activatedAssets: num(r.cnt)
    })),
    trendVsPrior: pctChange(dealsClosedWon, num(lead[0]?.won_prior))
  };
}

/**
 * Daily sparkline series for the three top-line totals over the window.
 * One bucketed pass per layer, then merged by date.
 */
async function loadSeries(db: Pool, scope: Scope, sinceDays: number): Promise<TrifectaSparkPoint[]> {
  const cid = scope.clientId;
  const map = new Map<string, TrifectaSparkPoint>();
  const ensure = (d: string) => {
    let p = map.get(d);
    if (!p) { p = { date: d, created: 0, activated: 0, revenue: 0 }; map.set(d, p); }
    return p;
  };

  // Created — intelligence_objects by day (the dominant created signal).
  const tenantFilter = cid
    ? `tenant_id IN (${scope.intelTenants.map(() => '?').join(',')})`
    : `(tenant_id = ? OR tenant_id LIKE 'client:%')`;
  const tenantParams = cid ? scope.intelTenants : [AV_TENANT];
  const [created] = await db.execute<(RowDataPacket & { d: string; n: number })[]>(
    `SELECT DATE(created_at) AS d, COUNT(*) AS n FROM intelligence_objects
      WHERE ${tenantFilter} AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE(created_at)`,
    [...tenantParams, sinceDays]
  );
  for (const r of created) ensure(String(r.d)).created += num(r.n);

  // Activated — social published + outreach sent, by day (the high-volume lanes).
  const socClient = cid ? `JOIN leads l ON s.lead_id = l.id AND l.client_id = ${cid}` : '';
  const socTenant = cid ? '' : `AND (s.tenant_id = ? OR s.tenant_id LIKE 'client:%')`;
  const socParams = cid ? [sinceDays] : [sinceDays, AV_TENANT];
  const [soc] = await db.execute<(RowDataPacket & { d: string; n: number })[]>(
    `SELECT DATE(s.published_at) AS d, COUNT(*) AS n FROM social_outbox s ${socClient}
      WHERE s.status = 'published' AND s.published_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ${socTenant}
      GROUP BY DATE(s.published_at)`,
    socParams
  );
  for (const r of soc) ensure(String(r.d)).activated += num(r.n);

  const outClient = cid ? `AND l.client_id = ${cid}` : '';
  const [out] = await db.execute<(RowDataPacket & { d: string; n: number })[]>(
    `SELECT DATE(m.sent_at) AS d, COUNT(*) AS n FROM outreach_messages m JOIN leads l ON m.lead_id = l.id
      WHERE m.status = 'sent' AND m.sent_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ${outClient}
      GROUP BY DATE(m.sent_at)`,
    [sinceDays]
  );
  for (const r of out) ensure(String(r.d)).activated += num(r.n);

  // Revenue — meetings booked + deals won, by day.
  const callClient = cid ? `AND l.client_id = ${cid}` : '';
  const [calls] = await db.execute<(RowDataPacket & { d: string; n: number })[]>(
    `SELECT DATE(cl.called_at) AS d, COUNT(*) AS n FROM call_log cl JOIN leads l ON cl.lead_id = l.id
      WHERE cl.outcome = 'meeting_booked' AND cl.called_at >= DATE_SUB(NOW(), INTERVAL ? DAY) ${callClient}
      GROUP BY DATE(cl.called_at)`,
    [sinceDays]
  );
  for (const r of calls) ensure(String(r.d)).revenue += num(r.n);

  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * One-shot loader for the dashboard: the full chain + sparkline series.
 * Reuses one pool across every query.
 */
export async function loadIntelligenceTrifecta(args: MetricArgs = {}): Promise<IntelligenceTrifecta> {
  const db = getAvDb();
  const sinceDays = args.sinceDays ?? 30;
  const scope = await buildScope(db, args.clientId);

  let clientName: string | null = null;
  if (scope.clientId) {
    const [crows] = await db.execute<(RowDataPacket & { client_name: string | null })[]>(
      `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
      [scope.clientId]
    );
    clientName = crows[0]?.client_name ?? `Client #${scope.clientId}`;
  }

  const [created, activated, revenue, series] = await Promise.all([
    intelligenceCreated({ clientId: args.clientId, sinceDays }, db),
    intelligenceActivated({ clientId: args.clientId, sinceDays }, db),
    revenueInfluenced({ clientId: args.clientId, sinceDays }, db),
    loadSeries(db, scope, sinceDays)
  ]);

  return {
    clientId: scope.clientId,
    clientName,
    sinceDays,
    created,
    activated,
    revenue,
    series,
    generatedAt: new Date().toISOString()
  };
}
