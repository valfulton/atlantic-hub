/**
 * lib/public_intel/feed.ts  (#380, val 2026-06-03)
 *
 * Unified chronological feed of EVERY intelligence event for a client —
 * every adapter run, every record produced, every cascade fired, every
 * distress score change. The "information everywhere" surface.
 *
 * Goal: no signal we pull rots invisible. If the engine spent a cent
 * fetching it, it shows up here.
 *
 * The feed combines three sources:
 *   1. public_intel_records — every raw record stored (per adapter)
 *   2. entity_distress_scores — every entity that scored above threshold
 *   3. worker_run_log — every scheduled run, when, what fired
 *
 * Ordered by event time, descending. Capped at N for the panel.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export type FeedEventKind = 'record' | 'distress_entity' | 'worker_run';

export interface FeedEvent {
  kind: FeedEventKind;
  at: Date;
  /** Human-readable line for the feed. */
  summary: string;
  /** Source kind (adapter) — e.g. 'ca_sos', 'courtlistener', or null for worker runs. */
  sourceKind: string | null;
  /** Entity key (when applicable). */
  entityKey: string | null;
  /** Distress score (when this is a distress_entity event). */
  score: number | null;
  /** Region tag (state code) when known. */
  regionCode: string | null;
}

export async function intelligenceFeedForClient(clientId: number, limit = 50): Promise<FeedEvent[]> {
  const out: FeedEvent[] = [];
  try {
    const db = getAvDb();
    // (#383) mysql2 execute() rejects bound LIMIT params; inline validated ints.
    const safeOuter = Math.max(1, Math.min(500, Math.floor(limit)));
    const halfLimit = Math.max(1, Math.floor(safeOuter / 2));
    const quarterLimit = Math.max(1, Math.floor(safeOuter / 4));

    // 1. Recent records.
    const [recordRows] = await db.execute<(RowDataPacket & {
      source_kind: string;
      entity_key: string;
      summary_label: string | null;
      region_code: string | null;
      fetched_at: Date;
    })[]>(
      `SELECT source_kind, entity_key, summary_label, region_code, fetched_at
         FROM public_intel_records
        WHERE client_id = ?
        ORDER BY fetched_at DESC
        LIMIT ${halfLimit}`,
      [clientId]
    );
    for (const r of recordRows) {
      out.push({
        kind: 'record',
        at: r.fetched_at,
        summary: r.summary_label ?? r.entity_key,
        sourceKind: r.source_kind,
        entityKey: r.entity_key,
        score: null,
        regionCode: r.region_code
      });
    }

    // 2. Distress entities updated recently.
    const [scoreRows] = await db.execute<(RowDataPacket & {
      entity_key: string;
      entity_label: string | null;
      score: number;
      region_code: string | null;
      last_recomputed_at: Date;
    })[]>(
      `SELECT entity_key, entity_label, score, region_code, last_recomputed_at
         FROM entity_distress_scores
        WHERE client_id = ?
        ORDER BY last_recomputed_at DESC
        LIMIT ${quarterLimit}`,
      [clientId]
    );
    for (const r of scoreRows) {
      out.push({
        kind: 'distress_entity',
        at: r.last_recomputed_at,
        summary: `${r.entity_label ?? r.entity_key} · score ${r.score}`,
        sourceKind: null,
        entityKey: r.entity_key,
        score: r.score,
        regionCode: r.region_code
      });
    }

    // 3. Worker run log (when present).
    try {
      const [runRows] = await db.execute<(RowDataPacket & {
        task: string;
        started_at: Date;
        status: string;
        adapter_count: number;
        cascade_recipes_fired: number;
        entities_scored: number;
        detail: string | null;
      })[]>(
        `SELECT task, started_at, status, adapter_count, cascade_recipes_fired, entities_scored, detail
           FROM worker_run_log
          WHERE client_id = ? OR client_id IS NULL
          ORDER BY started_at DESC
          LIMIT ${quarterLimit}`,
        [clientId]
      );
      for (const r of runRows) {
        out.push({
          kind: 'worker_run',
          at: r.started_at,
          summary: `Auto-refresh: ${r.task} · ${r.status} · ${r.adapter_count} adapters · ${r.cascade_recipes_fired} cascades · ${r.entities_scored} scored${r.detail ? ` · ${r.detail.slice(0, 80)}` : ''}`,
          sourceKind: null,
          entityKey: null,
          score: null,
          regionCode: null
        });
      }
    } catch {
      /* worker_run_log table may not exist yet — non-fatal */
    }

    // Sort by time desc, cap.
    out.sort((a, b) => b.at.getTime() - a.at.getTime());
    return out.slice(0, limit);
  } catch {
    return [];
  }
}
