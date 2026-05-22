/**
 * lib/pr/discovery.ts
 *
 * PROACTIVE opportunity discovery from intelligence the hub ALREADY holds -- no
 * external APIs, no scraping, no credentials. This is the lane the operator
 * asked for first: "the hub is already pulling data; the prompts should be
 * suggested based on opportunities." See
 * docs/CLAUDE_KICKOFF_PR_DISCOVERY_AND_ORCHESTRATION.md.
 *
 * Two internal signals in v1:
 *   1. Industry pain clusters -- when N clients in the same industry share a
 *      pain (leads.pain_point_profile.primary_pain), that recurring theme is a
 *      proactive thought-leadership / media angle. Also written back to the
 *      shared graph as a tenant-level `media_friendly_topics` intelligence object.
 *   2. Client wins -- a converted/high-scoring client is a press-release angle.
 *
 * Each signal becomes a SUGGESTED pr_opportunities row (suggested=1,
 * origin='internal_signal') with a deterministic, data-grounded why_it_matters
 * (no LLM call here -- the LLM drafter runs later when the operator clicks
 * Draft). Dedupe via dedupe_hash + uq_tenant_dedupe so re-running the sweep
 * never creates duplicates. Emits pr.* events.
 */

import { createHash } from 'crypto';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import { upsertIntelligenceObjects } from '@/lib/pr/drafter';
import { DEFAULT_TENANT, PR_EVENTS } from '@/lib/pr/types';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const MAX_SUGGESTIONS_PER_SWEEP = 8;
const MIN_CLUSTER_SIZE = 2; // a pain shared by >=2 clients in an industry

export interface DiscoverySweepResult {
  suggestionsCreated: number;
  industryClusters: number;
  clientWins: number;
}

interface PainRow extends RowDataPacket {
  industry: string | null;
  lead_id: number;
  primary_pain: string | null;
}

interface WinRow extends RowDataPacket {
  id: number;
  company: string;
  industry: string | null;
  lead_status: string | null;
  ai_score: number | null;
  client_id: number | null;
}

/**
 * Run the internal-signal discovery sweep for a tenant. Idempotent: re-running
 * upserts the same suggestions instead of duplicating them.
 */
export async function runInternalDiscoverySweep(args: {
  tenantId?: string;
  actorUserId?: number | null;
}): Promise<DiscoverySweepResult> {
  const tenantId = args.tenantId ?? DEFAULT_TENANT;
  const actorUserId = args.actorUserId ?? null;
  const started = Date.now();

  let created = 0;
  let industryClusters = 0;
  let clientWins = 0;

  // ---- Signal 1: industry pain clusters ----
  const clusters = await loadIndustryPainClusters();
  for (const cluster of clusters) {
    if (created >= MAX_SUGGESTIONS_PER_SWEEP) break;
    industryClusters++;
    const signalKey = `industry_pain:${cluster.industry}:${normalizeKey(cluster.theme)}`;
    const why =
      `${cluster.count} ${cluster.industry} businesses in your pipeline show the same pain: "${cluster.theme}". ` +
      `That is a strong ADVISORY outreach hook -- reach out to those prospects with a specific angle on ` +
      `solving it, and use the same theme for thought-leadership/social content. Note: these are leads, ` +
      `not clients, so any draft speaks in our voice TO them, not as them.`;
    const queryText =
      `Advisory outreach angle for ${cluster.industry} prospects: the recurring problem "${cluster.theme}" ` +
      `that ${cluster.count} businesses in this space are facing.`;
    const oppId = await upsertSuggestedOpportunity({
      tenantId,
      origin: 'internal_signal',
      queryText,
      topicTags: [cluster.industry.toLowerCase().slice(0, 48), 'industry-trend', 'thought-leadership'],
      whyItMatters: why,
      relevanceScore: clusterRelevance(cluster.count),
      matchedLeadId: cluster.exampleLeadId,
      dedupeHash: sha256(`${tenantId}:${signalKey}`),
      actorUserId
    });
    if (oppId) {
      created++;
      // Compound the graph: this recurring pain is a reusable media-friendly topic.
      await upsertIntelligenceObjects({
        tenantId,
        leadId: null,
        source: 'pr_discovery',
        objects: [
          {
            objectType: 'media_friendly_topics',
            objectJson: {
              industry: cluster.industry,
              theme: cluster.theme,
              client_count: cluster.count,
              detected_at: new Date().toISOString()
            },
            confidence: Math.min(95, 50 + cluster.count * 10)
          }
        ]
      });
    }
  }

  // ---- Signal 2: standout records ----
  // A real CLIENT (client_id set) is a genuine win we can announce in their
  // voice. A standout LEAD is NOT -- it is a prospect to reach out to with a
  // congratulatory angle, in our voice, never claiming anything as them.
  const wins = await loadClientWins();
  for (const win of wins) {
    if (created >= MAX_SUGGESTIONS_PER_SWEEP) break;
    clientWins++;
    const isClient = win.client_id != null;
    const where = win.industry ? ` in ${win.industry}` : '';
    const signalKey = isClient ? `client_win:${win.id}` : `prospect_standout:${win.id}`;
    const why = isClient
      ? `${win.company} is an active client${where}. Announcing their win builds proof points and ` +
        `authority and gives them a shareable moment -- draft this in their voice (press release / social).`
      : `${win.company} is a standout PROSPECT${where} (high fit). Open with a CONGRATULATORY outreach ` +
        `angle in our voice -- acknowledge what they appear to be doing well and offer a visibility idea. ` +
        `Do NOT write claims as them; this is outreach TO a prospect, not a client announcement.`;
    const queryText = isClient
      ? `Client win to announce: ${win.company}${win.industry ? ` (${win.industry})` : ''}.`
      : `Congratulatory outreach to prospect: ${win.company}${win.industry ? ` (${win.industry})` : ''}.`;
    const oppId = await upsertSuggestedOpportunity({
      tenantId,
      origin: 'internal_signal',
      queryText,
      topicTags: isClient
        ? ['client-win', 'press-release', win.industry ? win.industry.toLowerCase().slice(0, 48) : 'announcement']
        : ['prospect', 'congratulatory', 'outreach', win.industry ? win.industry.toLowerCase().slice(0, 48) : 'lead'],
      whyItMatters: why,
      relevanceScore: win.ai_score ? Math.min(100, win.ai_score) : 70,
      matchedLeadId: win.id,
      dedupeHash: sha256(`${tenantId}:${signalKey}`),
      actorUserId
    });
    if (oppId) created++;
  }

  await logEvent({
    eventType: PR_EVENTS.discoverySwept,
    userId: actorUserId,
    source: 'pr_discovery',
    executionTimeMs: Date.now() - started,
    payload: {
      tenant_id: tenantId,
      suggestions_created: created,
      industry_clusters: industryClusters,
      client_wins: clientWins
    }
  });

  return { suggestionsCreated: created, industryClusters, clientWins };
}

// ---------------------------------------------------------------------------
// Signal loaders
// ---------------------------------------------------------------------------

interface IndustryCluster {
  industry: string;
  theme: string;
  count: number;
  exampleLeadId: number;
}

async function loadIndustryPainClusters(): Promise<IndustryCluster[]> {
  const db = getAvDb();
  // Pull leads that have a pain profile + an industry; cluster in app code so we
  // can read the JSON primary_pain reliably across mysql2 JSON return shapes.
  const [rows] = await db.execute<PainRow[]>(
    `SELECT industry,
            id AS lead_id,
            JSON_UNQUOTE(JSON_EXTRACT(pain_point_profile, '$.primary_pain')) AS primary_pain
       FROM leads
      WHERE archived_at IS NULL
        AND industry IS NOT NULL AND industry <> ''
        AND pain_point_profile IS NOT NULL
      ORDER BY industry
      LIMIT 1000`
  );

  // group by (industry, normalized pain theme)
  const map = new Map<string, IndustryCluster>();
  for (const r of rows) {
    if (!r.industry || !r.primary_pain) continue;
    const theme = r.primary_pain.trim();
    if (theme.length < 4) continue;
    const key = `${r.industry}::${normalizeKey(theme)}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      map.set(key, { industry: r.industry, theme, count: 1, exampleLeadId: r.lead_id });
    }
  }

  return Array.from(map.values())
    .filter((c) => c.count >= MIN_CLUSTER_SIZE)
    .sort((a, b) => b.count - a.count);
}

async function loadClientWins(): Promise<WinRow[]> {
  const db = getAvDb();
  // A "win" = a converted lead, or a hot lead tied to a real client account.
  const [rows] = await db.execute<WinRow[]>(
    `SELECT id, company, industry, lead_status, ai_score, client_id
       FROM leads
      WHERE archived_at IS NULL
        AND (lead_status = 'converted' OR ai_score_band = 'hot')
      ORDER BY (client_id IS NOT NULL) DESC, (lead_status = 'converted') DESC, ai_score DESC, id DESC
      LIMIT 20`
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Insert or refresh a suggested opportunity. Returns the row id if a NEW row was
 * created, or 0 if it already existed (dedupe hit) so the caller can count
 * genuinely-new suggestions. Never throws out of the sweep.
 */
async function upsertSuggestedOpportunity(args: {
  tenantId: string;
  origin: string;
  queryText: string;
  topicTags: string[];
  whyItMatters: string;
  relevanceScore: number;
  matchedLeadId: number | null;
  dedupeHash: string;
  actorUserId: number | null;
}): Promise<number> {
  const db = getAvDb();
  try {
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO pr_opportunities
         (tenant_id, source, query_text, topic_tags, why_it_matters, matched_lead_id,
          status, origin, relevance_score, suggested, discovered_at, dedupe_hash, created_by_user_id)
       VALUES (?, 'manual', ?, CAST(? AS JSON), ?, ?, 'new', ?, ?, 1, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE
         query_text = VALUES(query_text),
         topic_tags = VALUES(topic_tags),
         why_it_matters = VALUES(why_it_matters),
         relevance_score = VALUES(relevance_score),
         matched_lead_id = COALESCE(VALUES(matched_lead_id), matched_lead_id),
         updated_at = NOW()`,
      [
        args.tenantId,
        args.queryText,
        JSON.stringify(args.topicTags),
        args.whyItMatters,
        args.matchedLeadId,
        args.origin,
        args.relevanceScore,
        args.dedupeHash,
        args.actorUserId
      ]
    );
    // insertId > 0 only on a genuine insert; ON DUPLICATE update yields 0.
    if (res.insertId && res.insertId > 0) {
      await logEvent({
        eventType: PR_EVENTS.opportunitySuggested,
        leadId: args.matchedLeadId,
        userId: args.actorUserId,
        source: 'pr_discovery',
        payload: { opportunity_id: res.insertId, origin: args.origin, relevance_score: args.relevanceScore }
      });
      return res.insertId;
    }
    return 0;
  } catch (err) {
    console.error('[pr:discovery:upsert]', (err as Error).message);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function clusterRelevance(count: number): number {
  return Math.max(40, Math.min(100, 50 + count * 12));
}

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 6)
    .join('-');
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
