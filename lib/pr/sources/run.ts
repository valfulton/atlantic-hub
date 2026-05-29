/**
 * lib/pr/sources/run.ts
 *
 * Runner for the configured external discovery lanes (Reddit, RSS) plus a
 * deeper cross-layer "what is actually converting" sweep. It reads
 * pr_discovery_sources (schema 027) for each active lane, calls the matching
 * adapter, and feeds every returned item through the shared ingestion path
 * (lib/pr/ingest.ts). It records last_run_at / last_status / last_detail back
 * on the source row and emits pr.discovery.* events.
 *
 * The performance sweep deepens discovery beyond leads/audits: it reads OUTREACH
 * conversion (outreach_replies joined to leads.industry) so suggestions compound
 * from what has actually resonated, then writes a tenant-level
 * `engagement_patterns` intelligence object + ranked SUGGESTED opportunities and
 * emits pr.topic.trending. (Social/commercial performance signals are additive
 * follow-ups on the same shape -- not faked here.)
 *
 * No migration: reuses pr_discovery_sources, pr_ingestion_log, pr_opportunities
 * (027) and intelligence_objects (025). Follows the Intelligence Loop
 * (SYSTEM_CONSTITUTION.md section 5). Never throws out of a sweep.
 */

import { createHash } from 'crypto';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import { upsertIntelligenceObjects } from '@/lib/pr/drafter';
import { ingestBatch } from '@/lib/pr/ingest';
import { applyPrResponsiveBump } from '@/lib/pr/responsive_bump';
import { fetchRedditOpportunities, parseRedditConfig } from '@/lib/pr/sources/reddit';
import { fetchRssOpportunities, parseRssConfig } from '@/lib/pr/sources/rss';
import { DEFAULT_TENANT, PR_EVENTS } from '@/lib/pr/types';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

interface SourceRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  kind: 'internal' | 'email_inbox' | 'reddit' | 'rss';
  config_json: unknown;
  is_active: number;
}

export interface LaneResult {
  sourceId: number;
  kind: 'reddit' | 'rss';
  parsed: number;
  duplicate: number;
  failed: number;
  detail: string;
}

export interface SourcesSweepResult {
  lanes: LaneResult[];
  performance: { suggestionsCreated: number; topIndustries: Array<{ industry: string; wins: number }> };
}

/**
 * Run all active reddit/rss sources for a tenant, then the performance sweep.
 * `sourceId` optionally restricts to a single configured source.
 */
export async function runExternalDiscovery(args: {
  tenantId?: string;
  actorUserId?: number | null;
  sourceId?: number | null;
}): Promise<SourcesSweepResult> {
  const tenantId = args.tenantId ?? DEFAULT_TENANT;
  const actorUserId = args.actorUserId ?? null;
  const db = getAvDb();

  const lanes: LaneResult[] = [];

  let sources: SourceRow[] = [];
  try {
    if (args.sourceId) {
      const [rows] = await db.execute<SourceRow[]>(
        `SELECT id, tenant_id, kind, config_json, is_active
           FROM pr_discovery_sources
          WHERE tenant_id = ? AND id = ? AND is_active = 1 AND kind IN ('reddit','rss')
          LIMIT 1`,
        [tenantId, args.sourceId]
      );
      sources = rows;
    } else {
      const [rows] = await db.execute<SourceRow[]>(
        `SELECT id, tenant_id, kind, config_json, is_active
           FROM pr_discovery_sources
          WHERE tenant_id = ? AND is_active = 1 AND kind IN ('reddit','rss')
          ORDER BY id ASC
          LIMIT 25`,
        [tenantId]
      );
      sources = rows;
    }
  } catch (err) {
    console.error('[pr:sources:load]', (err as Error).message);
  }

  for (const src of sources) {
    // The SQL already restricts to reddit/rss, but narrow for the type system
    // (ingestBatch.origin + LaneResult.kind exclude 'internal'/'email_inbox').
    const kind = src.kind;
    if (kind !== 'reddit' && kind !== 'rss') continue;

    const cfg = coerceJson(src.config_json);
    let result: { items: Awaited<ReturnType<typeof fetchRedditOpportunities>>['items']; detail: string; disabled: boolean };
    try {
      if (kind === 'reddit') {
        const parsed = parseRedditConfig(cfg);
        result = parsed
          ? await fetchRedditOpportunities(parsed)
          : { items: [], detail: 'reddit source: invalid config (need subreddits[])', disabled: true };
      } else {
        const parsed = parseRssConfig(cfg);
        result = parsed
          ? await fetchRssOpportunities(parsed)
          : { items: [], detail: 'rss source: invalid config (need feeds[])', disabled: true };
      }
    } catch (err) {
      result = { items: [], detail: `fetch error: ${(err as Error).message}`.slice(0, 480), disabled: false };
    }

    let ingest = { parsed: 0, duplicate: 0, failed: 0 };
    if (result.items.length) {
      const batch = await ingestBatch({
        items: result.items,
        origin: kind,
        tenantId,
        actorUserId,
        cap: 25
      });
      ingest = { parsed: batch.parsed, duplicate: batch.duplicate, failed: batch.failed };
    }

    const status = result.disabled ? 'disabled' : result.items.length ? 'ok' : 'empty';
    const detail = `${result.detail}; ingested parsed=${ingest.parsed} dup=${ingest.duplicate} failed=${ingest.failed}`;
    await updateSourceRun(db, src.id, status, detail);

    if (status === 'disabled' || ingest.failed > 0) {
      await logEvent({
        eventType: PR_EVENTS.discoverySourceFailed,
        userId: actorUserId,
        source: `pr_source:${src.kind}`,
        status: status === 'disabled' ? 'partial' : 'failure',
        payload: { source_id: src.id, kind: src.kind, detail: detail.slice(0, 480) }
      });
    } else {
      await logEvent({
        eventType: PR_EVENTS.discoverySwept,
        userId: actorUserId,
        source: `pr_source:${src.kind}`,
        payload: { source_id: src.id, kind: src.kind, parsed: ingest.parsed, duplicate: ingest.duplicate }
      });
    }

    lanes.push({
      sourceId: src.id,
      kind,
      parsed: ingest.parsed,
      duplicate: ingest.duplicate,
      failed: ingest.failed,
      detail
    });
  }

  const performance = await runPerformanceSweep({ tenantId, actorUserId });

  return { lanes, performance };
}

// ---------------------------------------------------------------------------
// Performance sweep: read what is actually converting, not just raw leads.
// ---------------------------------------------------------------------------

interface IndustryWinRow extends RowDataPacket {
  industry: string;
  wins: number;
  example_lead_id: number | null;
}

const PERF_WINDOW_DAYS = 90;
const PERF_MAX_SUGGESTIONS = 3;

export async function runPerformanceSweep(args: {
  tenantId?: string;
  actorUserId?: number | null;
}): Promise<{ suggestionsCreated: number; topIndustries: Array<{ industry: string; wins: number }> }> {
  const tenantId = args.tenantId ?? DEFAULT_TENANT;
  const actorUserId = args.actorUserId ?? null;
  const db = getAvDb();

  let rows: IndustryWinRow[] = [];
  try {
    // Outreach conversion by industry: positive/interested replies in the window.
    // PERF_WINDOW_DAYS is a fixed integer constant -- safe to inline (never bind
    // it; mysql2 + HostGator dislikes some bound scalars in INTERVAL/LIMIT).
    const [result] = await db.execute<IndustryWinRow[]>(
      `SELECT l.industry AS industry,
              COUNT(*) AS wins,
              MIN(l.id) AS example_lead_id
         FROM outreach_replies r
         JOIN leads l ON l.id = r.lead_id
        WHERE r.classification IN ('positive','interested')
          AND r.received_at >= (NOW() - INTERVAL ${PERF_WINDOW_DAYS} DAY)
          AND l.industry IS NOT NULL AND l.industry <> ''
          AND l.archived_at IS NULL
        GROUP BY l.industry
        ORDER BY wins DESC
        LIMIT 5`
    );
    rows = result;
  } catch (err) {
    // outreach tables may be empty or absent in some environments -- not fatal.
    console.error('[pr:sources:performance]', (err as Error).message);
    return { suggestionsCreated: 0, topIndustries: [] };
  }

  const topIndustries = rows.map((r) => ({ industry: r.industry, wins: Number(r.wins) }));
  if (!topIndustries.length) {
    return { suggestionsCreated: 0, topIndustries: [] };
  }

  // Compound the graph: a reusable engagement pattern (what converts, tenant-wide).
  await upsertIntelligenceObjects({
    tenantId,
    leadId: null,
    source: 'pr_performance_sweep',
    objects: [
      {
        objectType: 'engagement_patterns',
        objectJson: {
          signal: 'outreach_conversion_by_industry',
          window_days: PERF_WINDOW_DAYS,
          top_converting_industries: topIndustries,
          detected_at: new Date().toISOString()
        },
        confidence: Math.min(95, 50 + topIndustries[0].wins * 5)
      }
    ]
  });

  await logEvent({
    eventType: PR_EVENTS.topicTrending,
    userId: actorUserId,
    source: 'pr_performance_sweep',
    payload: { signal: 'outreach_conversion_by_industry', top: topIndustries.slice(0, 3) }
  });

  // Ranked SUGGESTED opportunities for the strongest-converting industries.
  let created = 0;
  for (const row of rows.slice(0, PERF_MAX_SUGGESTIONS)) {
    if (Number(row.wins) < 2) continue; // need real signal
    const industry = row.industry;
    const wins = Number(row.wins);
    const why =
      `Outreach in ${industry} is converting: ${wins} positive/interested replies in the last ${PERF_WINDOW_DAYS} days. ` +
      `That is proof this vertical is responsive right now -- double down with a thought-leadership / case-study angle ` +
      `aimed at ${industry} prospects while the interest is warm. These are leads, so any draft speaks in our voice TO them.`;
    const queryText =
      `Proven-converting vertical: ${industry}. ${wins} prospects replied positively to outreach in the last ` +
      `${PERF_WINDOW_DAYS} days -- a strong, timely angle for ${industry}-focused thought leadership.`;
    const dedupeHash = sha256(`${tenantId}:performance:industry_conversion:${normalize(industry)}`);
    // (#199) Bump if the example lead's client is fast-turnaround.
    const baseRelevance = Math.max(55, Math.min(100, 55 + wins * 6));
    const relevanceScore = await applyPrResponsiveBump(baseRelevance, row.example_lead_id);
    const created1 = await upsertSuggestedOpportunity({
      db,
      tenantId,
      origin: 'internal_signal',
      queryText,
      topicTags: [industry.toLowerCase().slice(0, 48), 'converting', 'thought-leadership', 'performance'],
      whyItMatters: why,
      relevanceScore,
      matchedLeadId: row.example_lead_id,
      dedupeHash,
      actorUserId
    });
    if (created1) created++;
  }

  return { suggestionsCreated: created, topIndustries };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function upsertSuggestedOpportunity(args: {
  db: ReturnType<typeof getAvDb>;
  tenantId: string;
  origin: string;
  queryText: string;
  topicTags: string[];
  whyItMatters: string;
  relevanceScore: number;
  matchedLeadId: number | null;
  dedupeHash: string;
  actorUserId: number | null;
}): Promise<boolean> {
  try {
    const [res] = await args.db.execute<ResultSetHeader>(
      `INSERT INTO pr_opportunities
         (tenant_id, source, query_text, topic_tags, why_it_matters, matched_lead_id,
          status, origin, relevance_score, suggested, discovered_at, dedupe_hash, created_by_user_id)
       VALUES (?, 'manual', ?, CAST(? AS JSON), ?, ?, 'new', ?, ?, 1, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE
         query_text = VALUES(query_text),
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
    if (res.insertId && res.insertId > 0) {
      await logEvent({
        eventType: PR_EVENTS.opportunitySuggested,
        leadId: args.matchedLeadId,
        userId: args.actorUserId,
        source: 'pr_performance_sweep',
        payload: { opportunity_id: res.insertId, origin: args.origin, relevance_score: args.relevanceScore }
      });
      return true;
    }
    return false;
  } catch (err) {
    console.error('[pr:sources:upsert_suggested]', (err as Error).message);
    return false;
  }
}

async function updateSourceRun(
  db: ReturnType<typeof getAvDb>,
  sourceId: number,
  status: string,
  detail: string
): Promise<void> {
  try {
    await db.execute<ResultSetHeader>(
      `UPDATE pr_discovery_sources
          SET last_run_at = NOW(), last_status = ?, last_detail = ?
        WHERE id = ?`,
      [status.slice(0, 32), detail.slice(0, 500), sourceId]
    );
  } catch (err) {
    console.error('[pr:sources:update_run]', (err as Error).message);
  }
}

function coerceJson(v: unknown): unknown {
  if (v == null) return {};
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }
  return v;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
