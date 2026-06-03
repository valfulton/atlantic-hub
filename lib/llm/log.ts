/**
 * lib/llm/log.ts  (#361, val 2026-06-02)
 *
 * Per-call accounting. Every LLM call (live OR cache hit) writes one row to
 * llm_call_log. Cache hits still log so val can see how much money the cache
 * SAVED — that's the "$0 because we'd seen this before" report.
 */
import { getAvDb } from '@/lib/db/av';
import type { ModelId, TaskKind } from './types';
import type { ResultSetHeader } from 'mysql2';

export interface LogCallInput {
  tenantId?: string;
  clientId?: number | null;
  taskKind: TaskKind;
  model: ModelId;
  inputTokens: number;
  outputTokens: number;
  costMicrocents: number;
  source: 'live' | 'cache';
  note?: string;
}

export async function logLlmCall(input: LogCallInput): Promise<void> {
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `INSERT INTO llm_call_log
         (tenant_id, client_id, task_kind, model,
          input_tokens, output_tokens, cost_microcents, source, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.tenantId ?? 'av',
        input.clientId ?? null,
        input.taskKind,
        input.model,
        input.inputTokens,
        input.outputTokens,
        input.costMicrocents,
        input.source,
        input.note?.slice(0, 255) ?? null
      ]
    );
  } catch {
    /* non-fatal */
  }
}
