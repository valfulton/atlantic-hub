/**
 * lib/pr/topic_overlap_bump.ts  (#214 v2)
 *
 * Second relevance modifier — applied right after applyPrResponsiveBump in
 * lib/pr/ingest.ts. When the matched lead belongs to a client whose intake
 * names PR_EXPERT_TOPICS, score the opportunity by how many of those topics
 * overlap with the parsed topic_tags. More overlap = higher rank in the
 * per-client PR list (#213) AND the global desk.
 *
 * Why this matters:
 *   - Before this bump, the discovery sweep matched opportunities to leads
 *     by industry / lead-candidate fit but had no idea what each client
 *     said they could actually speak to.
 *   - Tim/OPHORA can speak to "bio-quantum oxygenated water," "athlete
 *     recovery," "luxury whole-home filtration." A parsing-AI matched
 *     opportunity tagged ["health", "longevity", "athlete-recovery"]
 *     overlaps 1 token — that's signal worth +bump.
 *
 * Design:
 *   - PURE bump. Returns input unchanged on any miss/error. Never breaks
 *     ingest.
 *   - Compares tokens case-insensitively. Splits the intake field on commas
 *     / semicolons / pipes (val's intakes are free-text), strips whitespace,
 *     drops obvious noise tokens.
 *   - Counts UNIQUE overlaps (deduped on both sides) so a "luxury luxury
 *     luxury" tag list can't game the score.
 *   - +5 per overlap, cap +25 (5 strong overlaps).
 *
 * Same shape as responsive_bump.ts so the ingest path stays linear.
 */
import { getBriefSeed } from '@/lib/client/brief_store';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

const PER_MATCH_BUMP = 5;
const MAX_BUMP = 25;

// Words that should not count as "topic matches" even if they appear in
// both lists — too generic to mean anything (e.g. an intake that says "press,
// content, social" trivially overlaps almost every opportunity).
const NOISE = new Set([
  'press', 'pr', 'media', 'news', 'story', 'stories', 'content', 'social',
  'topic', 'topics', 'general', 'expert', 'business', 'company', 'industry',
  'the', 'and', 'or', 'of', 'in', 'on', 'to', 'a', 'an', 'for', 'with', 'at'
]);

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    // collapse internal whitespace, drop stray punctuation that gets glued
    // to tokens by free-text parsing
    .replace(/[".'!?()\[\]:]/g, '')
    .replace(/\s+/g, ' ');
}

function tokenizeIntakeTopics(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  // Intake field is free text — split on commas / semicolons / pipes /
  // newlines / " and ". Keep multi-word phrases ("athlete recovery") as one
  // token so they can match the topic_tags array directly.
  const tokens = raw
    .split(/[,;|\n]| and /i)
    .map((s) => normalize(s))
    .filter((s) => s.length >= 3 && !NOISE.has(s));
  return new Set(tokens);
}

function tokenizeTopicTags(tags: string[] | null | undefined): Set<string> {
  if (!Array.isArray(tags)) return new Set();
  const out = new Set<string>();
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const n = normalize(t).replace(/-/g, ' '); // tags often kebab-cased
    if (n.length >= 3 && !NOISE.has(n)) out.add(n);
  }
  return out;
}

/**
 * For a SET of opportunity tags and a SET of intake topics, count how many
 * pairs match by either:
 *   - exact normalized equality, OR
 *   - substring (one contains the other) for multi-word phrases,
 *     so an intake topic "athlete recovery" matches a tag "athlete-recovery"
 *     and an intake "bio-quantum oxygenation" matches a tag "oxygenated-water"
 * One overlap per intake topic max (an opportunity can't score the same
 * topic twice).
 */
function countOverlap(intake: Set<string>, tags: Set<string>): number {
  if (intake.size === 0 || tags.size === 0) return 0;
  let n = 0;
  for (const i of intake) {
    let matched = false;
    for (const t of tags) {
      if (i === t || (i.length >= 5 && t.length >= 5 && (i.includes(t) || t.includes(i)))) {
        matched = true;
        break;
      }
    }
    if (matched) n += 1;
  }
  return n;
}

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

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Apply the topic-overlap bump.
 *
 * @param baseRelevance the score after the prior bumps (0-100)
 * @param matchedLeadId the lead the opportunity matched to (or null)
 * @param topicTags the opportunity's parsed topic_tags
 * @returns the bumped (or unchanged) relevance, clamped 0-100
 */
export async function applyTopicOverlapBump(
  baseRelevance: number,
  matchedLeadId: number | null,
  topicTags: string[] | null | undefined
): Promise<number> {
  if (!matchedLeadId || !topicTags?.length) return clamp(baseRelevance);
  try {
    const clientId = await clientIdForLead(matchedLeadId);
    if (!clientId) return clamp(baseRelevance);
    const seed = await getBriefSeed('av', clientId);
    if (!seed) return clamp(baseRelevance);
    const intake = tokenizeIntakeTopics(seed.prExpertTopics);
    if (intake.size === 0) return clamp(baseRelevance);
    const tags = tokenizeTopicTags(topicTags);
    const overlap = countOverlap(intake, tags);
    if (overlap <= 0) return clamp(baseRelevance);
    const bump = Math.min(overlap * PER_MATCH_BUMP, MAX_BUMP);
    return clamp(baseRelevance + bump);
  } catch {
    return clamp(baseRelevance);
  }
}
