/**
 * lib/public_intel/store.ts  (#368, val 2026-06-02)
 *
 * Read/write layer for public_intel_sources + public_intel_records. Adapters
 * use these — they never touch the DB directly so a future store swap (e.g.
 * moving cache to Blobs) stays local.
 */
import { getAvDb } from '@/lib/db/av';
import type { PublicIntelKind, PublicIntelSource, PublicIntelRecord } from './types';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

interface SourceRow extends RowDataPacket {
  source_id: number;
  client_id: number | null;
  source_kind: string;
  enabled: number;
  config_json: string | object | null;
  last_run_at: Date | null;
  last_run_status: 'ok' | 'error' | 'skipped' | null;
  last_run_detail: string | null;
}

function parseJson<T = Record<string, unknown>>(v: string | object | null): T | null {
  if (v == null) return null;
  if (typeof v === 'object') return v as T;
  try { return JSON.parse(v) as T; } catch { return null; }
}

function rowToSource(r: SourceRow): PublicIntelSource {
  return {
    sourceId: Number(r.source_id),
    clientId: r.client_id == null ? null : Number(r.client_id),
    sourceKind: String(r.source_kind) as PublicIntelKind,
    enabled: !!r.enabled,
    config: parseJson(r.config_json),
    lastRunAt: r.last_run_at,
    lastRunStatus: r.last_run_status,
    lastRunDetail: r.last_run_detail
  };
}

export async function listSourcesForClient(clientId: number | null): Promise<PublicIntelSource[]> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<SourceRow[]>(
      `SELECT source_id, client_id, source_kind, enabled, config_json,
              last_run_at, last_run_status, last_run_detail
         FROM public_intel_sources
        WHERE client_id ${clientId == null ? 'IS NULL' : '= ?'}
        ORDER BY source_kind ASC`,
      clientId == null ? [] : [clientId]
    );
    return rows.map(rowToSource);
  } catch { return []; }
}

export async function upsertSource(input: {
  clientId: number | null;
  sourceKind: PublicIntelKind;
  enabled?: boolean;
  config?: Record<string, unknown> | null;
}): Promise<number | null> {
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO public_intel_sources (client_id, source_kind, enabled, config_json)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         enabled = VALUES(enabled),
         config_json = VALUES(config_json),
         updated_at = NOW()`,
      [
        input.clientId,
        input.sourceKind,
        input.enabled === false ? 0 : 1,
        input.config == null ? null : JSON.stringify(input.config)
      ]
    );
    return res.insertId || null;
  } catch { return null; }
}

export async function noteRun(input: {
  sourceId: number;
  status: 'ok' | 'error' | 'skipped';
  detail: string;
}): Promise<void> {
  try {
    const db = getAvDb();
    await db.execute(
      `UPDATE public_intel_sources
          SET last_run_at = NOW(), last_run_status = ?, last_run_detail = ?
        WHERE source_id = ?`,
      [input.status, input.detail.slice(0, 480), input.sourceId]
    );
  } catch { /* non-fatal */ }
}

export async function storeRecord<T = Record<string, unknown>>(input: {
  sourceKind: PublicIntelKind;
  entityKey: string;
  clientId?: number | null;
  leadId?: number | null;
  recordJson: T;
  summaryLabel?: string | null;
  regionCode?: string | null;
  expiresAt?: Date | null;
}): Promise<number | null> {
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO public_intel_records
         (source_kind, entity_key, client_id, lead_id, record_json,
          summary_label, region_code, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         client_id = COALESCE(VALUES(client_id), client_id),
         lead_id = COALESCE(VALUES(lead_id), lead_id),
         record_json = VALUES(record_json),
         summary_label = VALUES(summary_label),
         region_code = VALUES(region_code),
         expires_at = VALUES(expires_at),
         fetched_at = NOW()`,
      [
        input.sourceKind,
        input.entityKey.slice(0, 240),
        input.clientId ?? null,
        input.leadId ?? null,
        JSON.stringify(input.recordJson),
        input.summaryLabel?.slice(0, 240) ?? null,
        input.regionCode?.slice(0, 60) ?? null,
        input.expiresAt ?? null
      ]
    );
    return res.insertId || null;
  } catch { return null; }
}

export async function findCachedRecord<T = Record<string, unknown>>(
  sourceKind: PublicIntelKind,
  entityKey: string
): Promise<PublicIntelRecord<T> | null> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & {
      record_id: number;
      source_kind: string;
      entity_key: string;
      client_id: number | null;
      lead_id: number | null;
      record_json: string | object;
      summary_label: string | null;
      region_code: string | null;
      fetched_at: Date;
      expires_at: Date | null;
    })[]>(
      `SELECT record_id, source_kind, entity_key, client_id, lead_id,
              record_json, summary_label, region_code, fetched_at, expires_at
         FROM public_intel_records
        WHERE source_kind = ? AND entity_key = ?
        LIMIT 1`,
      [sourceKind, entityKey]
    );
    const r = rows[0];
    if (!r) return null;
    if (r.expires_at && r.expires_at < new Date()) return null;
    return {
      recordId: Number(r.record_id),
      sourceKind: r.source_kind as PublicIntelKind,
      entityKey: r.entity_key,
      clientId: r.client_id == null ? null : Number(r.client_id),
      leadId: r.lead_id == null ? null : Number(r.lead_id),
      recordJson: parseJson<T>(r.record_json) ?? ({} as T),
      summaryLabel: r.summary_label,
      regionCode: r.region_code,
      fetchedAt: r.fetched_at,
      expiresAt: r.expires_at
    };
  } catch { return null; }
}
