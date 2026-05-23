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

export interface NarrativeLane {
  id: number;
  tenantId: string;
  name: string;
  description: string | null;
  accent: string | null;
  cadenceHint: string | null;
  sortOrder: number;
  isActive: boolean;
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
    isActive: r.is_active === 1
  };
}

export async function listLanes(tenantId = DEFAULT_TENANT, opts?: { includeInactive?: boolean }): Promise<NarrativeLane[]> {
  const db = getAvDb();
  const where = ['tenant_id = ?', 'archived_at IS NULL'];
  if (!opts?.includeInactive) where.push('is_active = 1');
  const [rows] = await db.execute<LaneDbRow[]>(
    `SELECT id, tenant_id, name, description, accent, cadence_hint, sort_order, is_active
       FROM narrative_lanes WHERE ${where.join(' AND ')} ORDER BY sort_order ASC, name ASC`,
    [tenantId]
  );
  return rows.map(mapLane);
}

export async function createLane(input: {
  tenantId?: string;
  name: string;
  description?: string | null;
  accent?: string | null;
  cadenceHint?: string | null;
}): Promise<number> {
  const db = getAvDb();
  const tenantId = input.tenantId || DEFAULT_TENANT;
  const [maxRows] = await db.execute<(RowDataPacket & { m: number | null })[]>(
    `SELECT MAX(sort_order) AS m FROM narrative_lanes WHERE tenant_id = ?`,
    [tenantId]
  );
  const nextOrder = (maxRows[0]?.m ?? 0) + 1;
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO narrative_lanes (tenant_id, name, description, accent, cadence_hint, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE description = VALUES(description), accent = VALUES(accent),
       cadence_hint = VALUES(cadence_hint), is_active = 1, archived_at = NULL`,
    [tenantId, input.name.slice(0, 120), input.description?.slice(0, 500) ?? null, input.accent?.slice(0, 16) ?? null, input.cadenceHint?.slice(0, 120) ?? null, nextOrder]
  );
  return res.insertId;
}

export async function updateLane(
  id: number,
  patch: { name?: string; description?: string | null; accent?: string | null; cadenceHint?: string | null; isActive?: boolean; sortOrder?: number }
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
  if (sets.length === 0) return;
  vals.push(id);
  await db.execute<ResultSetHeader>(`UPDATE narrative_lanes SET ${sets.join(', ')} WHERE id = ?`, vals);
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
