/**
 * lib/public_intel/lead_match.ts  (#370, val 2026-06-02)
 *
 * Match public_intel_records to a specific lead so the lead detail page can
 * surface "here's the public-data context for this prospect" inline.
 *
 * Visibility-gap rule applied to Driver 8: every record landing in the store
 * has to appear somewhere the operator works. The lead detail Identity tab
 * is where conversations get planned — that's the right surface.
 *
 * Matching strategy (in order, first non-empty bucket wins):
 *   1. clientId match — records pulled for THIS client/lead context
 *   2. region match — records tagged with the lead's address_state /
 *      ZIP-prefix-derived FIPS / county FIPS
 *   3. company-name match — records whose summary_label contains the lead
 *      company token (for CA SOS entity rows)
 *
 * Returns up to N records per source_kind, most recently fetched first.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export interface LeadMatchedRecord {
  recordId: number;
  sourceKind: string;
  entityKey: string;
  summaryLabel: string | null;
  regionCode: string | null;
  record: unknown;
  fetchedAt: Date;
  matchReason: 'client' | 'region' | 'company';
}

interface LeadContext {
  leadId: number;
  clientId: number | null;
  company: string;
  addressState: string | null;
}

function parseJson(v: string | object | null): unknown {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

function rowToRecord(r: RowDataPacket & {
  record_id: number; source_kind: string; entity_key: string;
  summary_label: string | null; region_code: string | null;
  record_json: string | object; fetched_at: Date;
}, matchReason: LeadMatchedRecord['matchReason']): LeadMatchedRecord {
  return {
    recordId: Number(r.record_id),
    sourceKind: r.source_kind,
    entityKey: r.entity_key,
    summaryLabel: r.summary_label,
    regionCode: r.region_code,
    record: parseJson(r.record_json),
    fetchedAt: r.fetched_at,
    matchReason
  };
}

/**
 * Pull every public_intel_record that plausibly applies to this lead. Caller
 * groups by source_kind for rendering. Soft-fails (returns []) on any DB error.
 */
export async function matchedRecordsForLead(ctx: LeadContext, perKindLimit = 4): Promise<LeadMatchedRecord[]> {
  if (!Number.isInteger(ctx.leadId) || ctx.leadId <= 0) return [];
  const out: LeadMatchedRecord[] = [];
  try {
    const db = getAvDb();

    // (1) Client-scoped records.
    if (ctx.clientId) {
      const [rows] = await db.execute<(RowDataPacket & {
        record_id: number; source_kind: string; entity_key: string;
        summary_label: string | null; region_code: string | null;
        record_json: string | object; fetched_at: Date;
      })[]>(
        `SELECT record_id, source_kind, entity_key, summary_label, region_code,
                record_json, fetched_at
           FROM public_intel_records
          WHERE client_id = ?
          ORDER BY fetched_at DESC
          LIMIT 40`,
        [ctx.clientId]
      );
      for (const r of rows) out.push(rowToRecord(r, 'client'));
    }

    // (2) Region match — records tagged with the lead's state code. We don't
    // try to resolve ZIP→county here; that requires a FIPS map. Keeping the
    // match simple keeps the surface honest: "this is what we have for FL,
    // for now." A future bundle adds ZIP→county resolution.
    if (ctx.addressState) {
      const stateRaw = ctx.addressState.trim();
      // Normalize "FL" / "Florida". For now: only 2-letter postal.
      const state = stateRaw.length === 2 ? stateRaw.toUpperCase() : null;
      if (state) {
        const [rows] = await db.execute<(RowDataPacket & {
          record_id: number; source_kind: string; entity_key: string;
          summary_label: string | null; region_code: string | null;
          record_json: string | object; fetched_at: Date;
        })[]>(
          `SELECT record_id, source_kind, entity_key, summary_label, region_code,
                  record_json, fetched_at
             FROM public_intel_records
            WHERE region_code = ?
            ORDER BY fetched_at DESC
            LIMIT 40`,
          [state]
        );
        for (const r of rows) {
          if (out.some((x) => x.recordId === Number(r.record_id))) continue;
          out.push(rowToRecord(r, 'region'));
        }
      }
    }

    // (3) Company-name token match — CA SOS entity rows whose summary mentions
    // a strong token from the lead's company name. Keep this conservative:
    // only the longest two tokens (>=4 chars) to avoid noise.
    const tokens = (ctx.company || '')
      .split(/[\s,.&]+/)
      .filter((t) => t.length >= 4)
      .sort((a, b) => b.length - a.length)
      .slice(0, 2);
    if (tokens.length > 0) {
      const orClause = tokens.map(() => `summary_label LIKE ?`).join(' OR ');
      const args = tokens.map((t) => `%${t}%`);
      const [rows] = await db.execute<(RowDataPacket & {
        record_id: number; source_kind: string; entity_key: string;
        summary_label: string | null; region_code: string | null;
        record_json: string | object; fetched_at: Date;
      })[]>(
        `SELECT record_id, source_kind, entity_key, summary_label, region_code,
                record_json, fetched_at
           FROM public_intel_records
          WHERE source_kind = 'ca_sos'
            AND entity_key LIKE 'ca_sos:entity:%'
            AND (${orClause})
          ORDER BY fetched_at DESC
          LIMIT 20`,
        args
      );
      for (const r of rows) {
        if (out.some((x) => x.recordId === Number(r.record_id))) continue;
        out.push(rowToRecord(r, 'company'));
      }
    }
  } catch {
    return [];
  }

  // Cap per source_kind so a chatty source doesn't drown others.
  const perKindCount = new Map<string, number>();
  const capped: LeadMatchedRecord[] = [];
  for (const r of out) {
    const n = perKindCount.get(r.sourceKind) ?? 0;
    if (n >= perKindLimit) continue;
    perKindCount.set(r.sourceKind, n + 1);
    capped.push(r);
  }
  return capped;
}
