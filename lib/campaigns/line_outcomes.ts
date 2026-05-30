/**
 * lib/campaigns/line_outcomes.ts  (#46 spine Inc 3 — seeds #218)
 *
 * The narrative spine's first LEARNING signal: per line, how the leads it's
 * linked to are actually performing. One JOIN-and-GROUP-BY against
 * narrative_line_links + leads bucketed by lead_status — no LLM, no API cost,
 * fully derivable from existing pipeline state.
 *
 * This is the seed of the closed performance-to-narrative-line learning loop
 * (#218). v1 reads what's already there (lead_status: new, contacted,
 * qualified, converted, lost). Later we'll layer in call_log outcome signals,
 * social/blog engagement, PR placements, and per-line win-rate trending — but
 * v1 ships value immediately because the data is already accruing.
 *
 * Reads only. Fails soft (empty map on error) so the LeadNarrativeLines panel
 * and the cockpit can always render even if this query hiccups.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export interface LineOutcomes {
  /** Total leads linked to this line (any status, including 'new'). */
  leadsLinked: number;
  /** Past 'new' — outreach has started. */
  contacted: number;
  /** In active conversation / proven interest. */
  qualified: number;
  /** Closed-won. */
  converted: number;
  /** Closed-lost. */
  lost: number;
}

const EMPTY: LineOutcomes = { leadsLinked: 0, contacted: 0, qualified: 0, converted: 0, lost: 0 };

interface OutcomeRow extends RowDataPacket {
  narrative_line_id: number;
  lead_status: string | null;
  n: number | string;
}

/**
 * Per-line outcome rollup for many lines at once. One query, one GROUP BY —
 * cheap to call on a cockpit listing or on every LeadNarrativeLines render.
 * Lines without any linked leads come back with an EMPTY bucket so callers
 * don't have to special-case "not in the map."
 *
 * Statuses outside the canonical ENUM ('new','contacted','qualified',
 * 'converted','lost') are counted toward leadsLinked but not into any named
 * bucket — preserves the total without inventing a category for legacy data.
 */
export async function outcomesForLines(lineIds: number[]): Promise<Record<number, LineOutcomes>> {
  const result: Record<number, LineOutcomes> = {};
  const ids = lineIds.filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return result;
  for (const id of ids) result[id] = { ...EMPTY };

  try {
    const db = getAvDb();
    const placeholders = ids.map(() => '?').join(',');
    // Inner join to leads so archived/missing leads don't inflate counts.
    // We bucket in JS (not SQL CASE) so adding signals later — call_log
    // outcomes, won_at, replied_at — is a single map change here, not a
    // schema-wide rework.
    const [rows] = await db.execute<OutcomeRow[]>(
      `SELECT nll.narrative_line_id, l.lead_status, COUNT(*) AS n
         FROM narrative_line_links nll
         JOIN leads l ON l.id = nll.asset_id
        WHERE nll.asset_type = 'lead'
          AND nll.narrative_line_id IN (${placeholders})
          AND l.archived_at IS NULL
        GROUP BY nll.narrative_line_id, l.lead_status`,
      ids
    );

    for (const r of rows) {
      const bucket = result[r.narrative_line_id];
      if (!bucket) continue;
      const n = Number(r.n) || 0;
      bucket.leadsLinked += n;
      switch (r.lead_status) {
        case 'contacted': bucket.contacted += n; break;
        case 'qualified': bucket.qualified += n; break;
        case 'converted': bucket.converted += n; break;
        case 'lost':      bucket.lost += n; break;
        default: /* 'new' or legacy — counted in leadsLinked only */ break;
      }
    }
  } catch (err) {
    console.error('[line_outcomes]', (err as Error).message);
    /* empty buckets already seeded above */
  }
  return result;
}

/** Single-line convenience. */
export async function outcomesForLine(lineId: number): Promise<LineOutcomes> {
  const map = await outcomesForLines([lineId]);
  return map[lineId] ?? { ...EMPTY };
}

/**
 * Short human strip for chip-style display ("8 leads · 2 qualified · 1 won").
 * Returns an empty string when there's literally nothing to show — caller
 * just hides the row in that case.
 */
export function outcomesStrip(o: LineOutcomes): string {
  if (o.leadsLinked === 0) return '';
  const parts: string[] = [`${o.leadsLinked} lead${o.leadsLinked === 1 ? '' : 's'}`];
  if (o.qualified > 0) parts.push(`${o.qualified} qualified`);
  if (o.converted > 0) parts.push(`${o.converted} won`);
  if (o.lost > 0 && o.converted === 0 && o.qualified === 0) {
    // Only surface losses when there's nothing positive yet — otherwise we'd
    // drown the good signal. Operator can always look deeper on the cockpit.
    parts.push(`${o.lost} lost`);
  }
  return parts.join(' · ');
}
