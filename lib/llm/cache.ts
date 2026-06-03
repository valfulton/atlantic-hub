/**
 * lib/llm/cache.ts  (#361, val 2026-06-02)
 *
 * Content-hash keyed cache for LLM responses. Two invalidation modes:
 *
 *   - TIME (web-source tasks): row carries an expires_at; lookups past that
 *     time miss and the row gets evicted lazily on next miss.
 *   - EVENT (brief / intake-source tasks): the cache_key includes the source's
 *     updated_at timestamp. A brief edit changes the key → automatic miss →
 *     fresh call → store under the new key. No TTL needed; no DELETEs needed.
 *
 * Hit logging: every cache hit increments hit_count + bumps last_hit_at so val
 * can see WHICH cached responses are saving real money.
 */
import { createHash } from 'crypto';
import { getAvDb } from '@/lib/db/av';
import type { ModelId, TaskKind } from './types';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

interface CacheRow extends RowDataPacket {
  cache_key: string;
  model: string;
  task_kind: string;
  response_text: string;
  input_tokens: number;
  output_tokens: number;
  cost_microcents: number;
  expires_at: Date | null;
}

/**
 * Build the canonical cache key for a call. The hash includes the model, the
 * prompt, and any extras the caller passes (brief.updated_at for event-cached
 * tasks; user_id if responses are per-person; etc).
 */
export function cacheKeyFor(model: ModelId, prompt: string, extras: string[] = []): string {
  const canonical = JSON.stringify({ model, prompt, extras });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export interface CacheLookup {
  hit: boolean;
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  costMicrocents?: number;
}

export async function lookupCache(cacheKey: string): Promise<CacheLookup> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<CacheRow[]>(
      `SELECT cache_key, model, task_kind, response_text,
              input_tokens, output_tokens, cost_microcents, expires_at
         FROM llm_response_cache
        WHERE cache_key = ? LIMIT 1`,
      [cacheKey]
    );
    const r = rows[0];
    if (!r) return { hit: false };
    if (r.expires_at && r.expires_at.getTime() < Date.now()) {
      // Lazy eviction — past TTL.
      try {
        await db.execute<ResultSetHeader>(
          `DELETE FROM llm_response_cache WHERE cache_key = ?`,
          [cacheKey]
        );
      } catch { /* non-fatal */ }
      return { hit: false };
    }
    // Bump hit counter (fire-and-forget, do not block).
    void db.execute<ResultSetHeader>(
      `UPDATE llm_response_cache SET hit_count = hit_count + 1, last_hit_at = NOW() WHERE cache_key = ?`,
      [cacheKey]
    ).catch(() => undefined);
    return {
      hit: true,
      text: r.response_text,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      costMicrocents: r.cost_microcents
    };
  } catch {
    return { hit: false };
  }
}

export interface CacheStoreInput {
  cacheKey: string;
  model: ModelId;
  taskKind: TaskKind;
  responseText: string;
  inputTokens: number;
  outputTokens: number;
  costMicrocents: number;
  /** Set for TIME-cached tasks. Null/undefined for EVENT-cached (no eviction). */
  expiresAt?: Date | null;
}

export async function storeCache(input: CacheStoreInput): Promise<void> {
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `INSERT INTO llm_response_cache
         (cache_key, model, task_kind, response_text,
          input_tokens, output_tokens, cost_microcents, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         response_text = VALUES(response_text),
         input_tokens = VALUES(input_tokens),
         output_tokens = VALUES(output_tokens),
         cost_microcents = VALUES(cost_microcents),
         expires_at = VALUES(expires_at)`,
      [
        input.cacheKey,
        input.model,
        input.taskKind,
        input.responseText,
        input.inputTokens,
        input.outputTokens,
        input.costMicrocents,
        input.expiresAt ?? null
      ]
    );
  } catch {
    /* non-fatal: cache miss next time is fine */
  }
}
