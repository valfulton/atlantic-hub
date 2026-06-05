/**
 * lib/public_intel/move_brand.ts  (#386, val 2026-06-05)
 *
 * Cross-brand move on the distress watchlist. Adriana owns both CBB (collections)
 * and CLDA (legal-document assistance) — when a signal lands on CLDA's watchlist
 * that's actually a CBB-shaped target (B2B collections, exposed creditor, etc.),
 * she should be able to one-click "Move to CBB" and have the entity show up on
 * the right brand's watchlist with its cascade attribution preserved.
 *
 * Mechanics:
 *   - `entity_distress_scores` is keyed by (client_id, entity_key).
 *   - Moving means: if a row at the target already exists for that entity_key,
 *     merge (keep the higher score + most recent first_seen_at, union the
 *     contributing_signals) and delete the source row. If no target row,
 *     straight UPDATE client_id on the source row.
 *   - The cascade attribution travels because contributing_signals carries it.
 *
 * No reversal table for v1 — if val moves something wrongly she can move it
 * back. A follow-up could log moves to a brand_move_log table.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export type MoveResult =
  | { ok: true; mode: 'moved' | 'merged'; toClientId: number }
  | { ok: false; reason: 'same_brand' | 'source_not_found' | 'db_error'; detail?: string };

/**
 * Move a watchlist entity from `fromClientId` to `toClientId`. Caller is
 * responsible for authorization (owner of BOTH brands) — this is a pure
 * data layer and does no auth checks.
 */
export async function moveDistressEntity(args: {
  fromClientId: number;
  toClientId: number;
  entityKey: string;
}): Promise<MoveResult> {
  const { fromClientId, toClientId, entityKey } = args;
  if (fromClientId === toClientId) {
    return { ok: false, reason: 'same_brand' };
  }
  if (!Number.isInteger(fromClientId) || !Number.isInteger(toClientId)) {
    return { ok: false, reason: 'db_error', detail: 'invalid client ids' };
  }
  if (!entityKey || typeof entityKey !== 'string') {
    return { ok: false, reason: 'source_not_found', detail: 'no entity_key' };
  }

  try {
    const db = getAvDb();

    type SrcRow = RowDataPacket & {
      score_id: number;
      score: number;
      contributing_signals: string | null;
      first_seen_at: Date;
      entity_label: string | null;
      region_code: string | null;
    };
    const [srcRows] = await db.execute<SrcRow[]>(
      `SELECT score_id, score, contributing_signals, first_seen_at, entity_label, region_code
         FROM entity_distress_scores
        WHERE client_id = ? AND entity_key = ?
        LIMIT 1`,
      [fromClientId, entityKey]
    );
    const src = srcRows[0];
    if (!src) return { ok: false, reason: 'source_not_found' };

    type TgtRow = RowDataPacket & {
      score_id: number;
      score: number;
      contributing_signals: string | null;
      first_seen_at: Date;
    };
    const [tgtRows] = await db.execute<TgtRow[]>(
      `SELECT score_id, score, contributing_signals, first_seen_at
         FROM entity_distress_scores
        WHERE client_id = ? AND entity_key = ?
        LIMIT 1`,
      [toClientId, entityKey]
    );
    const tgt = tgtRows[0];

    if (!tgt) {
      // Simple move — re-key the row.
      await db.execute<ResultSetHeader>(
        `UPDATE entity_distress_scores
            SET client_id = ?, last_recomputed_at = NOW()
          WHERE score_id = ?`,
        [toClientId, src.score_id]
      );
      return { ok: true, mode: 'moved', toClientId };
    }

    // Merge — keep the higher score, older first_seen_at, union the signals.
    const mergedScore = Math.max(Number(src.score), Number(tgt.score));
    const earliestFirstSeen =
      new Date(src.first_seen_at).getTime() < new Date(tgt.first_seen_at).getTime()
        ? src.first_seen_at
        : tgt.first_seen_at;
    const mergedSignals = mergeSignals(src.contributing_signals, tgt.contributing_signals);
    await db.execute<ResultSetHeader>(
      `UPDATE entity_distress_scores
          SET score = ?, contributing_signals = ?, first_seen_at = ?, last_recomputed_at = NOW()
        WHERE score_id = ?`,
      [mergedScore, JSON.stringify(mergedSignals), earliestFirstSeen, tgt.score_id]
    );
    await db.execute<ResultSetHeader>(
      `DELETE FROM entity_distress_scores WHERE score_id = ?`,
      [src.score_id]
    );
    return { ok: true, mode: 'merged', toClientId };
  } catch (err) {
    return { ok: false, reason: 'db_error', detail: (err as Error).message.slice(0, 200) };
  }
}

/** De-dup contributing_signals by signalKind + source pair. */
function mergeSignals(srcJson: string | null, tgtJson: string | null): unknown[] {
  const a = safeArray(srcJson);
  const b = safeArray(tgtJson);
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const sig of [...b, ...a]) {
    if (!sig || typeof sig !== 'object') continue;
    const o = sig as { signalKind?: string; source?: string };
    const key = `${o.signalKind || ''}|${o.source || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sig);
  }
  return out;
}

function safeArray(json: string | null): unknown[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
