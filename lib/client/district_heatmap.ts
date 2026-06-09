/**
 * lib/client/district_heatmap.ts
 *
 * District heat map data access (#550 v2, political_campaign engagement kind).
 *
 * Reads brief.district_zips (comma string OR string[] OR JSON-array),
 * normalizes to a string[], and aggregates public_intel_records by
 * (zip, signal_kind). Returns ranked signals: 'rising' > 'new' > 'steady',
 * tiebreak on count descending.
 *
 * Degrades gracefully: missing field, empty list, missing table, or DB error
 * all return []. The panel renders an honest empty-state on that.
 *
 * Assumes public_intel_records has a `zip` column (or a `metadata` JSON
 * field with zip). The query SELECTs both shapes and unions them so the lib
 * works regardless of which schema the adapter writes to.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export interface DistrictSignal {
  zip: string;
  signalKind: string;
  count: number;
  severity: 'rising' | 'new' | 'steady';
  lastSeenAt: string | null;
}

interface BriefShape {
  district_zips?: string | string[] | null;
}

/**
 * Parse district_zips from a brief payload into a clean string[] of 5-digit
 * zips. Accepts comma string, space-separated string, raw array, or JSON.
 */
export function parseDistrictZips(brief: BriefShape | Record<string, unknown> | null | undefined): string[] {
  if (!brief) return [];
  const raw = (brief as BriefShape).district_zips;
  if (!raw) return [];
  let candidates: string[] = [];
  if (Array.isArray(raw)) candidates = raw.map(String);
  else if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return [];
    if (t.startsWith('[')) {
      try {
        const arr = JSON.parse(t) as unknown;
        if (Array.isArray(arr)) candidates = arr.map(String);
      } catch {
        candidates = t.split(/[\s,]+/);
      }
    } else {
      candidates = t.split(/[\s,]+/);
    }
  }
  // Normalize: 5 digits only, dedup, capped at 30 to keep the query bounded.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const m = String(c).match(/\d{5}/);
    if (!m) continue;
    const z = m[0];
    if (seen.has(z)) continue;
    seen.add(z);
    out.push(z);
    if (out.length >= 30) break;
  }
  return out;
}

interface AggRow extends RowDataPacket {
  zip: string;
  signal_kind: string;
  n: number;
  last_seen: string | null;
}

const SEVERITY_ORDER: Record<DistrictSignal['severity'], number> = {
  rising: 0, new: 1, steady: 2
};

/**
 * Resolve the heat map for a political_campaign brand.
 * Returns [] on any miss (no zips, no table, no rows, error).
 */
export async function getDistrictHeatMap(
  brief: Record<string, unknown> | null | undefined,
  options: { sinceDays?: number; limit?: number } = {}
): Promise<DistrictSignal[]> {
  const zips = parseDistrictZips(brief);
  if (zips.length === 0) return [];
  const sinceDays = Math.max(1, Math.min(180, Math.floor(options.sinceDays ?? 60)));
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 8)));
  try {
    const db = getAvDb();
    // UNION: read zip from `zip` column OR from metadata->>'$.zip' so the
    // lib works whichever shape the public-intel adapters write to.
    const placeholders = zips.map(() => '?').join(',');
    const [rows] = await db.execute<AggRow[]>(
      `SELECT zip, signal_kind, COUNT(*) AS n, MAX(seen_at) AS last_seen
         FROM (
           SELECT COALESCE(zip, JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.zip'))) AS zip,
                  signal_kind, seen_at
             FROM public_intel_records
            WHERE seen_at >= NOW() - INTERVAL ${sinceDays} DAY
         ) p
        WHERE p.zip IN (${placeholders})
        GROUP BY zip, signal_kind
        ORDER BY n DESC
        LIMIT ?`,
      [...zips, limit * 2]
    );

    // Severity is computed from recency: anything seen in the last 7 days
    // with no prior history counts as 'new'; anything with a 7d count >
    // its 30d-prior count counts as 'rising'; everything else 'steady'.
    // For v1 we keep it simple — recent rows are 'rising', single-row buckets
    // are 'new', the rest are 'steady'. Tune later with real signal trending.
    const now = Date.now();
    const eightDays = 8 * 86_400_000;
    const out: DistrictSignal[] = rows.map((r) => {
      const lastT = r.last_seen ? new Date(r.last_seen).getTime() : 0;
      const recent = lastT > 0 && (now - lastT) < eightDays;
      const severity: DistrictSignal['severity'] =
        r.n === 1 && recent ? 'new' :
        recent ? 'rising' : 'steady';
      return {
        zip: r.zip,
        signalKind: r.signal_kind,
        count: Number(r.n),
        severity,
        lastSeenAt: r.last_seen
      };
    });

    out.sort((a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.count - a.count
    );
    return out.slice(0, limit);
  } catch (err) {
    console.error('[district_heatmap]', (err as Error).message);
    return [];
  }
}
