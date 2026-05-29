/**
 * lib/pr/client_sources.ts  (#214)
 *
 * Per-client PR discovery source management. Lets val configure RSS feeds
 * tuned to each client's actual world:
 *   - John White (congressional candidate) -> Axios Politico, The Hill,
 *     Roll Call, his district's local press
 *   - Adriana (legal services) -> ABA Journal, Law360, California Legal news
 *   - Ron Elfenbein (healthcare) -> Modern Healthcare, FierceHealthcare,
 *     KFF Health News
 *
 * Sources with client_id IS NULL stay tenant-wide (current behavior).
 * Sources with client_id set produce opportunities tagged with that client
 * so the per-client PR section (#213) can prioritize them.
 *
 * Keep this file thin -- the actual ingestion logic lives in
 * lib/pr/sources/run.ts. This is just the CRUD for the config rows.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export type PrSourceKind = 'rss' | 'reddit';

export interface ClientPrSource {
  id: number;
  tenantId: string;
  clientId: number | null;
  kind: PrSourceKind;
  label: string | null;
  configJson: unknown;
  isActive: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastDetail: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SourceRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  client_id: number | null;
  kind: PrSourceKind;
  label: string | null;
  config_json: string | object | null;
  is_active: number;
  last_run_at: string | null;
  last_status: string | null;
  last_detail: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSource(r: SourceRow): ClientPrSource {
  let configJson: unknown = null;
  if (r.config_json) {
    if (typeof r.config_json === 'object') configJson = r.config_json;
    else { try { configJson = JSON.parse(r.config_json as string); } catch { configJson = r.config_json; } }
  }
  return {
    id: r.id,
    tenantId: r.tenant_id,
    clientId: r.client_id,
    kind: r.kind,
    label: r.label,
    configJson,
    isActive: r.is_active === 1,
    lastRunAt: r.last_run_at,
    lastStatus: r.last_status,
    lastDetail: r.last_detail,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

/** All sources tagged to a specific client. Active and inactive. */
export async function listSourcesForClient(clientId: number): Promise<ClientPrSource[]> {
  const db = getAvDb();
  const [rows] = await db.execute<SourceRow[]>(
    `SELECT id, tenant_id, client_id, kind, label, config_json, is_active,
            last_run_at, last_status, last_detail, created_at, updated_at
       FROM pr_discovery_sources
      WHERE client_id = ?
      ORDER BY id ASC`,
    [clientId]
  );
  return rows.map(rowToSource);
}

/**
 * Add a new RSS source for a client. Keeps the existing source-row shape:
 * config_json holds { url, label? } so the existing parseRssConfig in
 * lib/pr/sources/rss.ts reads it without changes.
 */
export async function addRssSourceForClient(args: {
  clientId: number;
  tenantId: string;
  url: string;
  label?: string | null;
}): Promise<ClientPrSource> {
  const config = { url: args.url.trim() };
  const db = getAvDb();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO pr_discovery_sources
       (tenant_id, client_id, kind, label, config_json, is_active)
     VALUES (?, ?, 'rss', ?, CAST(? AS JSON), 1)`,
    [args.tenantId, args.clientId, args.label || null, JSON.stringify(config)]
  );
  const [rows] = await db.execute<SourceRow[]>(
    `SELECT id, tenant_id, client_id, kind, label, config_json, is_active,
            last_run_at, last_status, last_detail, created_at, updated_at
       FROM pr_discovery_sources WHERE id = ? LIMIT 1`,
    [res.insertId]
  );
  return rowToSource(rows[0]!);
}

/** Toggle active flag. Inactive sources are skipped by the discovery runner. */
export async function setSourceActive(sourceId: number, clientId: number, active: boolean): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `UPDATE pr_discovery_sources SET is_active = ? WHERE id = ? AND client_id = ?`,
    [active ? 1 : 0, sourceId, clientId]
  );
}

/** Hard-delete a client's source. */
export async function deleteSource(sourceId: number, clientId: number): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `DELETE FROM pr_discovery_sources WHERE id = ? AND client_id = ?`,
    [sourceId, clientId]
  );
}
