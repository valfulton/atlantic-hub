/**
 * lib/campaigns/store.ts
 *
 * Data access for narrative lanes (editable editorial pillars) and campaigns
 * (coordinated pushes within a lane). The orchestration spine: artifacts carry
 * campaign_id, campaigns roll up into a lane. See schema/036_campaigns_lanes.sql.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const DEFAULT_TENANT = 'av';

/** Lifecycle of a narrative line. candidate = proposed, steers nothing yet;
 *  active = steering content now (HARD CAP 2-4/tenant); reinforcing = proven,
 *  doubling down; retiring = winding down. See schema/038_narrative_lines.sql. */
export type NarrativeLineState = 'candidate' | 'active' | 'reinforcing' | 'retiring';

/** Max ACTIVE (incl. reinforcing) lines per tenant. The #1 anti-sprawl law. */
export const MAX_ACTIVE_LINES = 4;

export interface NarrativeLane {
  id: number;
  tenantId: string;
  name: string;
  description: string | null;
  accent: string | null;
  cadenceHint: string | null;
  sortOrder: number;
  isActive: boolean;
  // Narrative-line intelligence (schema 038). A line is a market thesis, not a category.
  state: NarrativeLineState;
  thesis: string | null;
  audience: string | null;
  emotionalDriver: string | null;
  authorityAngle: string | null;
  seasonality: string | null;
  conversionSignal: string | null;
  proofPoints: string[];
  bestChannels: string[];
  doSay: string[];
  dontSay: string[];
}

export interface CampaignRow {
  id: number;
  tenantId: string;
  laneId: number | null;
  leadId: number | null;
  name: string;
  goal: string | null;
  status: 'planning' | 'active' | 'paused' | 'done';
  company: string | null;
  artifactCount: number;
  createdAt: string;
}

interface LaneDbRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  name: string;
  description: string | null;
  accent: string | null;
  cadence_hint: string | null;
  sort_order: number;
  is_active: 0 | 1;
  state: NarrativeLineState;
  thesis: string | null;
  audience: string | null;
  emotional_driver: string | null;
  authority_angle: string | null;
  seasonality: string | null;
  conversion_signal: string | null;
  proof_points: unknown;
  best_channels: unknown;
  do_say: unknown;
  dont_say: unknown;
}

/** JSON columns come back from mysql2 as either a parsed value or a string,
 *  depending on driver config. Coerce defensively to a string[]. */
function asStrArray(v: unknown): string[] {
  if (v == null) return [];
  let val: unknown = v;
  if (typeof val === 'string') {
    const s = val.trim();
    if (!s) return [];
    try { val = JSON.parse(s); } catch { return [s]; }
  }
  if (Array.isArray(val)) return val.map((x) => String(x)).filter(Boolean);
  return [];
}

interface CampaignDbRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  lane_id: number | null;
  lead_id: number | null;
  name: string;
  goal: string | null;
  status: CampaignRow['status'];
  company: string | null;
  artifact_count: number;
  created_at: string;
}

function mapLane(r: LaneDbRow): NarrativeLane {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    description: r.description,
    accent: r.accent,
    cadenceHint: r.cadence_hint,
    sortOrder: r.sort_order,
    isActive: r.is_active === 1,
    state: r.state ?? 'active',
    thesis: r.thesis ?? null,
    audience: r.audience ?? null,
    emotionalDriver: r.emotional_driver ?? null,
    authorityAngle: r.authority_angle ?? null,
    seasonality: r.seasonality ?? null,
    conversionSignal: r.conversion_signal ?? null,
    proofPoints: asStrArray(r.proof_points),
    bestChannels: asStrArray(r.best_channels),
    doSay: asStrArray(r.do_say),
    dontSay: asStrArray(r.dont_say)
  };
}

const LANE_COLS =
  'id, tenant_id, name, description, accent, cadence_hint, sort_order, is_active, ' +
  'state, thesis, audience, emotional_driver, authority_angle, seasonality, ' +
  'conversion_signal, proof_points, best_channels, do_say, dont_say';

export async function listLanes(tenantId = DEFAULT_TENANT, opts?: { includeInactive?: boolean }): Promise<NarrativeLane[]> {
  const db = getAvDb();
  const where = ['tenant_id = ?', 'archived_at IS NULL'];
  if (!opts?.includeInactive) where.push('is_active = 1');
  const [rows] = await db.execute<LaneDbRow[]>(
    `SELECT ${LANE_COLS}
       FROM narrative_lanes WHERE ${where.join(' AND ')} ORDER BY sort_order ASC, name ASC`,
    [tenantId]
  );
  return rows.map(mapLane);
}

/** One narrative line by id (null if archived/missing). */
export async function getLane(id: number): Promise<NarrativeLane | null> {
  const db = getAvDb();
  const [rows] = await db.execute<LaneDbRow[]>(
    `SELECT ${LANE_COLS} FROM narrative_lanes WHERE id = ? AND archived_at IS NULL LIMIT 1`,
    [id]
  );
  return rows[0] ? mapLane(rows[0]) : null;
}

/** The 2-4 lines actually steering content right now (active + reinforcing). */
export async function listActiveLines(tenantId = DEFAULT_TENANT): Promise<NarrativeLane[]> {
  const db = getAvDb();
  const [rows] = await db.execute<LaneDbRow[]>(
    `SELECT ${LANE_COLS} FROM narrative_lanes
      WHERE tenant_id = ? AND archived_at IS NULL AND state IN ('active','reinforcing')
      ORDER BY sort_order ASC, name ASC`,
    [tenantId]
  );
  return rows.map(mapLane);
}

/** How many lines are currently steering content (for the anti-sprawl cap). */
export async function countActiveLines(tenantId = DEFAULT_TENANT): Promise<number> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM narrative_lanes
      WHERE tenant_id = ? AND archived_at IS NULL AND state IN ('active','reinforcing')`,
    [tenantId]
  );
  return Number(rows[0]?.c) || 0;
}

/**
 * Move a line through its lifecycle. Enforces the hard cap (MAX_ACTIVE_LINES):
 * promoting to active/reinforcing past the cap is refused, so the system can
 * never sprawl into messaging chaos. Returns { ok, activeCount, message }.
 */
export async function setLineState(
  id: number,
  state: NarrativeLineState,
  tenantId = DEFAULT_TENANT
): Promise<{ ok: boolean; activeCount: number; message?: string }> {
  const db = getAvDb();
  if (state === 'active' || state === 'reinforcing') {
    const current = await getLane(id);
    const alreadyActive = current?.state === 'active' || current?.state === 'reinforcing';
    if (!alreadyActive) {
      const count = await countActiveLines(tenantId);
      if (count >= MAX_ACTIVE_LINES) {
        return {
          ok: false,
          activeCount: count,
          message: `You already have ${count} active narrative lines (max ${MAX_ACTIVE_LINES}). Retire one before activating another — keeping it to a few is what keeps the messaging coherent.`
        };
      }
    }
  }
  await db.execute<ResultSetHeader>(
    `UPDATE narrative_lanes SET state = ? WHERE id = ?`,
    [state, id]
  );
  return { ok: true, activeCount: await countActiveLines(tenantId) };
}

/** Stringify a list for a JSON column, or null when empty/undefined. */
function jsonList(v: string[] | undefined | null): string | null {
  if (!v || v.length === 0) return null;
  return JSON.stringify(v.map((s) => String(s)).filter(Boolean));
}

/** The thesis/intelligence fields a line can carry (all optional). */
export interface NarrativeLineFields {
  thesis?: string | null;
  audience?: string | null;
  emotionalDriver?: string | null;
  authorityAngle?: string | null;
  seasonality?: string | null;
  conversionSignal?: string | null;
  proofPoints?: string[];
  bestChannels?: string[];
  doSay?: string[];
  dontSay?: string[];
  state?: NarrativeLineState;
}

export async function createLane(input: {
  tenantId?: string;
  name: string;
  description?: string | null;
  accent?: string | null;
  cadenceHint?: string | null;
} & NarrativeLineFields): Promise<number> {
  const db = getAvDb();
  const tenantId = input.tenantId || DEFAULT_TENANT;
  const [maxRows] = await db.execute<(RowDataPacket & { m: number | null })[]>(
    `SELECT MAX(sort_order) AS m FROM narrative_lanes WHERE tenant_id = ?`,
    [tenantId]
  );
  const nextOrder = (maxRows[0]?.m ?? 0) + 1;
  // New lines default to 'candidate' so they never silently bust the active cap.
  const state: NarrativeLineState = input.state ?? 'candidate';
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO narrative_lanes
       (tenant_id, name, description, accent, cadence_hint, sort_order, state,
        thesis, audience, emotional_driver, authority_angle, seasonality,
        conversion_signal, proof_points, best_channels, do_say, dont_say)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE description = VALUES(description), accent = VALUES(accent),
       cadence_hint = VALUES(cadence_hint), is_active = 1, archived_at = NULL`,
    [
      tenantId, input.name.slice(0, 120), input.description?.slice(0, 500) ?? null,
      input.accent?.slice(0, 16) ?? null, input.cadenceHint?.slice(0, 120) ?? null, nextOrder, state,
      input.thesis?.slice(0, 500) ?? null, input.audience?.slice(0, 300) ?? null,
      input.emotionalDriver?.slice(0, 200) ?? null, input.authorityAngle?.slice(0, 200) ?? null,
      input.seasonality?.slice(0, 160) ?? null, input.conversionSignal?.slice(0, 300) ?? null,
      jsonList(input.proofPoints), jsonList(input.bestChannels), jsonList(input.doSay), jsonList(input.dontSay)
    ]
  );
  return res.insertId;
}

export async function updateLane(
  id: number,
  patch: { name?: string; description?: string | null; accent?: string | null; cadenceHint?: string | null; isActive?: boolean; sortOrder?: number } & NarrativeLineFields
): Promise<void> {
  const db = getAvDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name.slice(0, 120)); }
  if (patch.description !== undefined) { sets.push('description = ?'); vals.push(patch.description?.slice(0, 500) ?? null); }
  if (patch.accent !== undefined) { sets.push('accent = ?'); vals.push(patch.accent?.slice(0, 16) ?? null); }
  if (patch.cadenceHint !== undefined) { sets.push('cadence_hint = ?'); vals.push(patch.cadenceHint?.slice(0, 120) ?? null); }
  if (patch.isActive !== undefined) { sets.push('is_active = ?'); vals.push(patch.isActive ? 1 : 0); }
  if (patch.sortOrder !== undefined) { sets.push('sort_order = ?'); vals.push(patch.sortOrder); }
  // Narrative-line intelligence fields. NOTE: change `state` via setLineState()
  // (it enforces the active cap); we intentionally do NOT set state here.
  if (patch.thesis !== undefined) { sets.push('thesis = ?'); vals.push(patch.thesis?.slice(0, 500) ?? null); }
  if (patch.audience !== undefined) { sets.push('audience = ?'); vals.push(patch.audience?.slice(0, 300) ?? null); }
  if (patch.emotionalDriver !== undefined) { sets.push('emotional_driver = ?'); vals.push(patch.emotionalDriver?.slice(0, 200) ?? null); }
  if (patch.authorityAngle !== undefined) { sets.push('authority_angle = ?'); vals.push(patch.authorityAngle?.slice(0, 200) ?? null); }
  if (patch.seasonality !== undefined) { sets.push('seasonality = ?'); vals.push(patch.seasonality?.slice(0, 160) ?? null); }
  if (patch.conversionSignal !== undefined) { sets.push('conversion_signal = ?'); vals.push(patch.conversionSignal?.slice(0, 300) ?? null); }
  if (patch.proofPoints !== undefined) { sets.push('proof_points = ?'); vals.push(jsonList(patch.proofPoints)); }
  if (patch.bestChannels !== undefined) { sets.push('best_channels = ?'); vals.push(jsonList(patch.bestChannels)); }
  if (patch.doSay !== undefined) { sets.push('do_say = ?'); vals.push(jsonList(patch.doSay)); }
  if (patch.dontSay !== undefined) { sets.push('dont_say = ?'); vals.push(jsonList(patch.dontSay)); }
  if (sets.length === 0) return;
  vals.push(id);
  await db.execute<ResultSetHeader>(`UPDATE narrative_lanes SET ${sets.join(', ')} WHERE id = ?`, vals);
}

/**
 * buildNarrativeContext — the one helper every generator uses to stay on-thesis.
 *
 * PURE DATA: a single indexed SELECT, no LLM/API call. Returns the structured
 * line plus a ready-to-inject `promptBlock` string you append to a generator's
 * system or user prompt. Because every channel reads the SAME line, messaging
 * can't drift — and when you pivot the line, every downstream prompt pivots with
 * it. Returns null when there's no line (callers should degrade gracefully).
 */
export interface NarrativeContext {
  lineId: number;
  name: string;
  thesis: string | null;
  audience: string | null;
  emotionalDriver: string | null;
  authorityAngle: string | null;
  seasonality: string | null;
  proofPoints: string[];
  bestChannels: string[];
  doSay: string[];
  dontSay: string[];
  /** Drop this into a system/user prompt. Empty string if the line is bare. */
  promptBlock: string;
}

export async function buildNarrativeContext(lineId: number | null | undefined): Promise<NarrativeContext | null> {
  if (!lineId || !Number.isInteger(lineId) || lineId <= 0) return null;
  const line = await getLane(lineId);
  if (!line) return null;

  const lines: string[] = ['NARRATIVE LINE (every word must advance this market thesis):'];
  lines.push(`- Line: ${line.name}`);
  if (line.thesis) lines.push(`- Thesis: ${line.thesis}`);
  if (line.audience) lines.push(`- Audience: ${line.audience}`);
  if (line.emotionalDriver) lines.push(`- Emotional driver: ${line.emotionalDriver}`);
  if (line.authorityAngle) lines.push(`- Authority angle: ${line.authorityAngle}`);
  if (line.seasonality) lines.push(`- Timing/seasonality: ${line.seasonality}`);
  if (line.proofPoints.length) lines.push(`- Proof points to draw on: ${line.proofPoints.join('; ')}`);
  if (line.doSay.length) lines.push(`- Stay on-thesis (do): ${line.doSay.join('; ')}`);
  if (line.dontSay.length) lines.push(`- Off-thesis (avoid): ${line.dontSay.join('; ')}`);
  // Only emit a block when the line carries real substance beyond its name.
  const promptBlock = lines.length > 2 ? lines.join('\n') : '';

  return {
    lineId: line.id,
    name: line.name,
    thesis: line.thesis,
    audience: line.audience,
    emotionalDriver: line.emotionalDriver,
    authorityAngle: line.authorityAngle,
    seasonality: line.seasonality,
    proofPoints: line.proofPoints,
    bestChannels: line.bestChannels,
    doSay: line.doSay,
    dontSay: line.dontSay,
    promptBlock
  };
}

/** Resolve the narrative context for a campaign (campaign -> lane_id -> line). */
export async function buildNarrativeContextForCampaign(campaignId: number | null | undefined): Promise<NarrativeContext | null> {
  if (!campaignId || !Number.isInteger(campaignId) || campaignId <= 0) return null;
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { lane_id: number | null })[]>(
    `SELECT lane_id FROM campaigns WHERE id = ? AND archived_at IS NULL LIMIT 1`,
    [campaignId]
  );
  return buildNarrativeContext(rows[0]?.lane_id ?? null);
}

export async function listCampaigns(tenantId = DEFAULT_TENANT): Promise<CampaignRow[]> {
  const db = getAvDb();
  const [rows] = await db.execute<CampaignDbRow[]>(
    `SELECT c.id, c.tenant_id, c.lane_id, c.lead_id, c.name, c.goal, c.status,
            l.company AS company,
            (SELECT COUNT(*) FROM content_artifacts a WHERE a.campaign_id = c.id) AS artifact_count,
            c.created_at
       FROM campaigns c
       LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.tenant_id = ? AND c.archived_at IS NULL
      ORDER BY c.created_at DESC
      LIMIT 200`,
    [tenantId]
  );
  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    laneId: r.lane_id,
    leadId: r.lead_id,
    name: r.name,
    goal: r.goal,
    status: r.status,
    company: r.company,
    artifactCount: Number(r.artifact_count) || 0,
    createdAt: r.created_at
  }));
}

export interface CampaignContent {
  campaign: { id: number; name: string; goal: string | null; status: string; laneId: number | null; company: string | null };
  artifacts: Array<{ id: number; artifactType: string; title: string | null; status: string }>;
  commercials: Array<{ id: number; assetType: string; auditId: string | null; brandedStatus: string | null }>;
}

/** Assign (or clear, campaignId=null) a content artifact to a campaign. */
export async function assignArtifactToCampaign(artifactId: number, campaignId: number | null): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(`UPDATE content_artifacts SET campaign_id = ?, updated_at = NOW() WHERE id = ?`, [campaignId, artifactId]);
}

/** Assign (or clear) a generated commercial asset to a campaign. */
export async function assignAssetToCampaign(assetId: number, campaignId: number | null): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(`UPDATE grok_imagine_assets SET campaign_id = ? WHERE id = ?`, [campaignId, assetId]);
}

/** A campaign plus the blog/commercial content compiled into it. */
export async function getCampaignContent(campaignId: number): Promise<CampaignContent | null> {
  const db = getAvDb();
  const [cRows] = await db.execute<(RowDataPacket & { id: number; name: string; goal: string | null; status: string; lane_id: number | null; company: string | null })[]>(
    `SELECT c.id, c.name, c.goal, c.status, c.lane_id, l.company
       FROM campaigns c LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.id = ? AND c.archived_at IS NULL LIMIT 1`,
    [campaignId]
  );
  const c = cRows[0];
  if (!c) return null;

  const [aRows] = await db.execute<(RowDataPacket & { id: number; artifact_type: string; title: string | null; status: string })[]>(
    `SELECT id, artifact_type, title, status FROM content_artifacts WHERE campaign_id = ? ORDER BY id DESC LIMIT 100`,
    [campaignId]
  );
  const [mRows] = await db.execute<(RowDataPacket & { id: number; asset_type: string; audit_id: string | null; branded_status: string | null })[]>(
    `SELECT g.id, g.asset_type, l.audit_id, g.branded_status
       FROM grok_imagine_assets g LEFT JOIN leads l ON l.id = g.lead_id
      WHERE g.campaign_id = ? AND g.archived_at IS NULL ORDER BY g.id DESC LIMIT 100`,
    [campaignId]
  );

  return {
    campaign: { id: c.id, name: c.name, goal: c.goal, status: c.status, laneId: c.lane_id, company: c.company },
    artifacts: aRows.map((r) => ({ id: r.id, artifactType: r.artifact_type, title: r.title, status: r.status })),
    commercials: mRows.map((r) => ({ id: r.id, assetType: r.asset_type, auditId: r.audit_id, brandedStatus: r.branded_status }))
  };
}

/** Campaigns a given lead is a target of (for the lead-side picker). */
export async function listCampaignsForLead(leadId: number): Promise<Array<{ id: number; name: string }>> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { id: number; name: string })[]>(
    `SELECT c.id, c.name
       FROM campaigns c JOIN campaign_leads cl ON cl.campaign_id = c.id
      WHERE cl.lead_id = ? AND c.archived_at IS NULL
      ORDER BY c.created_at DESC LIMIT 100`,
    [leadId]
  );
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

export interface CampaignTarget {
  leadId: number;
  company: string | null;
  painCategory: string | null;
  industry: string | null;
}

export interface PainCluster {
  industry: string | null;
  painCategory: string;
  count: number;
}

/** Leads currently targeted by a campaign. */
export async function getCampaignTargets(campaignId: number): Promise<CampaignTarget[]> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { lead_id: number; company: string | null; pain_category: string | null; industry: string | null })[]>(
    `SELECT cl.lead_id, l.company, l.industry,
            JSON_UNQUOTE(JSON_EXTRACT(l.pain_point_profile, '$.pain_category')) AS pain_category
       FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id
      WHERE cl.campaign_id = ? AND l.archived_at IS NULL
      ORDER BY l.company ASC LIMIT 500`,
    [campaignId]
  );
  return rows.map((r) => ({ leadId: r.lead_id, company: r.company, painCategory: r.pain_category, industry: r.industry }));
}

/** Attach specific leads to a campaign (idempotent). Returns how many were added. */
export async function attachLeads(campaignId: number, leadIds: number[]): Promise<number> {
  const ids = Array.from(new Set(leadIds.filter((n) => Number.isFinite(n) && n > 0)));
  if (ids.length === 0) return 0;
  const db = getAvDb();
  const values = ids.map(() => '(?, ?)').join(', ');
  const params: number[] = [];
  for (const id of ids) params.push(campaignId, id);
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT IGNORE INTO campaign_leads (campaign_id, lead_id) VALUES ${values}`,
    params
  );
  return res.affectedRows;
}

/** Attach ALL active leads sharing a pain (and optionally an industry). The
 *  "multiple clients via similar pain points" move. Returns how many were added. */
export async function attachLeadsByPain(campaignId: number, opts: { painCategory: string; industry?: string | null }): Promise<number> {
  const db = getAvDb();
  const where: string[] = ["JSON_UNQUOTE(JSON_EXTRACT(pain_point_profile, '$.pain_category')) = ?", 'archived_at IS NULL'];
  const vals: unknown[] = [campaignId, opts.painCategory];
  if (opts.industry) {
    where.push('industry = ?');
    vals.push(opts.industry);
  }
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT IGNORE INTO campaign_leads (campaign_id, lead_id)
       SELECT ?, id FROM leads WHERE ${where.join(' AND ')}`,
    vals
  );
  return res.affectedRows;
}

export async function detachLead(campaignId: number, leadId: number): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(`DELETE FROM campaign_leads WHERE campaign_id = ? AND lead_id = ?`, [campaignId, leadId]);
}

/** Pain clusters available to target: (industry, pain_category) with lead counts. */
export async function listPainClusters(): Promise<PainCluster[]> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { industry: string | null; pain_category: string; c: number })[]>(
    `SELECT industry,
            JSON_UNQUOTE(JSON_EXTRACT(pain_point_profile, '$.pain_category')) AS pain_category,
            COUNT(*) AS c
       FROM leads
      WHERE archived_at IS NULL
        AND JSON_EXTRACT(pain_point_profile, '$.pain_category') IS NOT NULL
        AND JSON_UNQUOTE(JSON_EXTRACT(pain_point_profile, '$.pain_category')) <> 'other'
      GROUP BY industry, pain_category
      HAVING c > 0
      ORDER BY c DESC
      LIMIT 60`
  );
  return rows.map((r) => ({ industry: r.industry, painCategory: r.pain_category, count: Number(r.c) || 0 }));
}

export async function createCampaign(input: {
  tenantId?: string;
  laneId: number | null;
  leadId: number | null;
  name: string;
  goal?: string | null;
  userId?: number | null;
}): Promise<number> {
  const db = getAvDb();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO campaigns (tenant_id, lane_id, lead_id, name, goal, status, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, 'planning', ?)`,
    [input.tenantId || DEFAULT_TENANT, input.laneId, input.leadId, input.name.slice(0, 200), input.goal?.slice(0, 1000) ?? null, input.userId ?? null]
  );
  return res.insertId;
}
