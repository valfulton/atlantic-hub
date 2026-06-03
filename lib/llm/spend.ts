/**
 * lib/llm/spend.ts  (#367, val 2026-06-02)
 *
 * Roll-up helpers for the per-client and total LLM spend, read from
 * llm_call_log. Used by the cross-client list page and (future) operator
 * home page. Costs are in microcents (integer math, no float drift).
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export interface PerClientSpend {
  clientId: number;
  liveMicrocents: number;
  liveCallCount: number;
  cacheHitCount: number;
}

/**
 * Sum live spend per client_id over the last N days. Cache hits counted but
 * cost zero (cache hits have cost_microcents=0 by design).
 */
export async function spendByClientLastDays(days: number): Promise<Map<number, PerClientSpend>> {
  const out = new Map<number, PerClientSpend>();
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & {
      client_id: number;
      live_microcents: number | string | null;
      live_calls: number | string;
      cache_hits: number | string;
    })[]>(
      `SELECT
         client_id,
         SUM(CASE WHEN source='live' THEN cost_microcents ELSE 0 END) AS live_microcents,
         SUM(CASE WHEN source='live' THEN 1 ELSE 0 END) AS live_calls,
         SUM(CASE WHEN source='cache' THEN 1 ELSE 0 END) AS cache_hits
       FROM llm_call_log
       WHERE client_id IS NOT NULL
         AND ts >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY client_id`,
      [days]
    );
    for (const r of rows) {
      out.set(Number(r.client_id), {
        clientId: Number(r.client_id),
        liveMicrocents: Number(r.live_microcents ?? 0),
        liveCallCount: Number(r.live_calls ?? 0),
        cacheHitCount: Number(r.cache_hits ?? 0)
      });
    }
  } catch {
    /* non-fatal: table missing or query fails → empty map */
  }
  return out;
}

/**
 * One-row tenant-wide total over the last N days (operator-side rollup).
 */
export async function totalSpendLastDays(days: number): Promise<{
  liveMicrocents: number;
  liveCallCount: number;
  cacheHitCount: number;
}> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & {
      live_microcents: number | string | null;
      live_calls: number | string;
      cache_hits: number | string;
    })[]>(
      `SELECT
         SUM(CASE WHEN source='live' THEN cost_microcents ELSE 0 END) AS live_microcents,
         SUM(CASE WHEN source='live' THEN 1 ELSE 0 END) AS live_calls,
         SUM(CASE WHEN source='cache' THEN 1 ELSE 0 END) AS cache_hits
       FROM llm_call_log
       WHERE ts >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days]
    );
    const r = rows[0];
    return {
      liveMicrocents: Number(r?.live_microcents ?? 0),
      liveCallCount: Number(r?.live_calls ?? 0),
      cacheHitCount: Number(r?.cache_hits ?? 0)
    };
  } catch {
    return { liveMicrocents: 0, liveCallCount: 0, cacheHitCount: 0 };
  }
}
