/**
 * Cross-client watchlist read layer for /admin/av/watchlist.
 * Aggregates entity_distress_scores across every client + joins client/name.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export interface UnifiedWatchlistRow {
  entityKey: string;
  entityLabel: string | null;
  regionCode: string | null;
  score: number;
  clientId: number;
  clientName: string;
  clientSlug: string;
  contributingSignals: { kind: string; label: string }[];
  firstSeenAt: Date;
  lastRecomputedAt: Date;
  lastAction: 'contacted' | 'dismissed' | 'converted' | 'ignored' | null;
  lastActedAt: Date | null;
}

export interface ListUnifiedWatchlistOpts {
  /** Filter to a single client. */
  clientId?: number | null;
  /** Filter to a single signal kind label (e.g. 'CA SOS suspension'). */
  signalKind?: string | null;
  /** Minimum score (default 0). */
  minScore?: number;
  /** Only entries first seen within N days. Default = no limit. */
  withinDays?: number | null;
  /** Free-text match on entity_label (LIKE). */
  q?: string | null;
  /** Hard cap. */
  limit?: number;
}

export async function listUnifiedWatchlist(
  opts: ListUnifiedWatchlistOpts = {}
): Promise<UnifiedWatchlistRow[]> {
  const limit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? 200)));
  const minScore = Math.max(0, Math.floor(opts.minScore ?? 0));
  const where: string[] = ['s.score >= ?'];
  const params: (string | number)[] = [minScore];
  if (opts.clientId) {
    where.push('s.client_id = ?');
    params.push(opts.clientId);
  }
  if (opts.withinDays && opts.withinDays > 0) {
    where.push('s.first_seen_at >= DATE_SUB(NOW(), INTERVAL ? DAY)');
    params.push(opts.withinDays);
  }
  if (opts.q && opts.q.trim()) {
    where.push('s.entity_label LIKE ?');
    params.push(`%${opts.q.trim()}%`);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  try {
    const db = getAvDb();
    type Row = RowDataPacket & {
      entity_key: string;
      entity_label: string | null;
      region_code: string | null;
      score: number;
      contributing_signals: string | object | null;
      first_seen_at: Date;
      last_recomputed_at: Date;
      last_action: 'contacted' | 'dismissed' | 'converted' | 'ignored' | null;
      last_acted_at: Date | null;
      client_id: number;
      client_name: string;
      client_slug: string;
    };
    const [rows] = await db.execute<Row[]>(
      `SELECT s.entity_key, s.entity_label, s.region_code, s.score,
              s.contributing_signals, s.first_seen_at, s.last_recomputed_at,
              s.last_action, s.last_acted_at,
              s.client_id, c.client_name, c.client_slug
         FROM entity_distress_scores s
         JOIN clients c ON c.client_id = s.client_id
        ${whereSql}
        ORDER BY s.score DESC, s.last_recomputed_at DESC
        LIMIT ${limit}`,
      params
    );

    return rows
      .map((r) => {
        const signals = parseSignals(r.contributing_signals);
        // Optional kind filter — done after fetch since signals are JSON.
        if (opts.signalKind && !signals.some((s) => s.kind === opts.signalKind || s.label === opts.signalKind)) {
          return null;
        }
        return {
          entityKey: r.entity_key,
          entityLabel: r.entity_label,
          regionCode: r.region_code,
          score: Number(r.score),
          clientId: r.client_id,
          clientName: r.client_name,
          clientSlug: r.client_slug,
          contributingSignals: signals,
          firstSeenAt: r.first_seen_at,
          lastRecomputedAt: r.last_recomputed_at,
          lastAction: r.last_action,
          lastActedAt: r.last_acted_at
        };
      })
      .filter((r): r is UnifiedWatchlistRow => r !== null);
  } catch (err) {
    console.error('[unified-watchlist]', (err as Error).message);
    return [];
  }
}

/** Distinct signal kinds across all rows — for the filter dropdown. */
export async function listSignalKinds(): Promise<string[]> {
  try {
    const db = getAvDb();
    type Row = RowDataPacket & { contributing_signals: string | null };
    const [rows] = await db.execute<Row[]>(
      `SELECT DISTINCT contributing_signals FROM entity_distress_scores
        WHERE contributing_signals IS NOT NULL LIMIT 500`
    );
    const labels = new Set<string>();
    for (const r of rows) {
      const sigs = parseSignals(r.contributing_signals);
      for (const s of sigs) labels.add(s.label || s.kind);
    }
    return Array.from(labels).sort();
  } catch {
    return [];
  }
}

/** Clients with at least one watchlist entry — for the filter dropdown. */
export async function listClientsWithWatchlist(): Promise<{ clientId: number; clientName: string; count: number }[]> {
  try {
    const db = getAvDb();
    type Row = RowDataPacket & { client_id: number; client_name: string; n: number };
    const [rows] = await db.execute<Row[]>(
      `SELECT s.client_id, c.client_name, COUNT(*) AS n
         FROM entity_distress_scores s
         JOIN clients c ON c.client_id = s.client_id
        GROUP BY s.client_id, c.client_name
        ORDER BY n DESC, c.client_name ASC`
    );
    return rows.map((r) => ({
      clientId: r.client_id,
      clientName: r.client_name,
      count: Number(r.n)
    }));
  } catch {
    return [];
  }
}

function parseSignals(raw: string | object | null): { kind: string; label: string }[] {
  if (!raw) return [];
  let arr: unknown;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return []; }
  } else {
    arr = raw;
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({
      kind: typeof x.kind === 'string' ? x.kind : '',
      label: typeof x.label === 'string' ? x.label : (typeof x.kind === 'string' ? x.kind : '')
    }))
    .filter((s) => s.label || s.kind);
}
