/**
 * lib/pr/responsive_bump.ts
 *
 * (#199) Small relevance modifier applied to a PR opportunity right before
 * it lands in pr_opportunities. When the matched lead belongs to a client
 * who flagged themselves as 'fast-turnaround available' on intake
 * (pr_responsive=yes), bump the opportunity's relevance_score so it floats
 * higher in the inbox. Journalists who pay attention to deadlines are
 * exactly the journalists who match well with quote-and-go clients.
 *
 * Design choices:
 *   - PURE bump, no deadline awareness (yet). The deadline-aware version
 *     would multiply the bump for tight-deadline opportunities; a future
 *     refinement, not a Tier 3 requirement.
 *   - Returns the input relevance unchanged on any error or miss so the
 *     ingest path never breaks because of a missing intake field.
 *   - Threshold is permissive: 'yes' / 'y' / 'true' / 'on' / 'available'
 *     all count. Conductor (val) controls the input language via the
 *     intake field hint -- the helper meets her where she ends up.
 */

import { getAvDb } from '@/lib/db/av';
import { getBriefSeed } from '@/lib/client/brief_store';
import type { RowDataPacket } from 'mysql2';

/** Flat bump applied when responsive=yes. Capped at 100. */
const RESPONSIVE_BUMP = 8;

const POSITIVE_TOKENS = ['yes', 'y', 'true', 'on', 'available', 'sure', 'absolutely'];

function isResponsiveYes(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const v = raw.toLowerCase().trim();
  if (!v) return false;
  // Strip common leading words like "Yes -- ..." and match the head token.
  const head = v.split(/[\s,;:.-]+/, 1)[0];
  return POSITIVE_TOKENS.includes(head);
}

/**
 * Resolve a matched lead's client_id without touching the heavier loaders.
 * One indexed lookup; non-fatal on error.
 */
async function clientIdForLead(leadId: number): Promise<number | null> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { client_id: number | null })[]>(
      `SELECT client_id FROM leads WHERE id = ? LIMIT 1`,
      [leadId]
    );
    return rows[0]?.client_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Apply the PR-responsive bump to a base relevance score.
 *
 * @param baseRelevance the score the lane computed (0-100)
 * @param matchedLeadId the lead the opportunity was matched to (or null)
 * @returns the bumped (or unchanged) relevance, clamped 0-100
 */
export async function applyPrResponsiveBump(
  baseRelevance: number,
  matchedLeadId: number | null
): Promise<number> {
  if (!matchedLeadId) return clamp(baseRelevance);
  try {
    const clientId = await clientIdForLead(matchedLeadId);
    if (!clientId) return clamp(baseRelevance);
    const seed = await getBriefSeed('av', clientId);
    if (!seed) return clamp(baseRelevance);
    if (isResponsiveYes(seed.prResponsive)) {
      return clamp(baseRelevance + RESPONSIVE_BUMP);
    }
    return clamp(baseRelevance);
  } catch {
    return clamp(baseRelevance);
  }
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
