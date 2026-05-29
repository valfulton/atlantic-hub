/**
 * lib/pr/ingest.ts
 *
 * The normalized inbound-ingestion path for the PR / Narrative Intelligence
 * engine. ALL external discovery lanes converge here:
 *   - the PR inbox webhook (origin 'email_inbox')
 *   - the Reddit lane (origin 'reddit')
 *   - the RSS lane (origin 'rss')
 *
 * One raw item -> dedupe (dedupe_hash) -> the EXISTING parseOpportunity()
 * drafter -> a pr_opportunities row -> a pr_ingestion_log entry. We do NOT
 * reinvent the parser, the event logger, or the dedupe key; this file is the
 * thin normalizer that feeds the opportunity graph from real external channels
 * and logs every item for closed-loop learning. See
 * docs/CLAUDE_KICKOFF_PR_PHASE3_HANDOFF.md (P2/P6) and SYSTEM_CONSTITUTION.md
 * (Intelligence Loop + the inbound-webhook pattern from lib/clay/webhook.ts).
 *
 * Tables (schema 027, already shipped -- NO migration here):
 *   pr_opportunities (origin/relevance_score/suggested/discovered_at/dedupe_hash,
 *                     uq_tenant_dedupe), pr_ingestion_log.
 *
 * Honesty note: these are REAL external requests, so they land as
 * suggested=0 (the "Opportunity inbox"), not suggested=1 ("Ideas from your
 * data"). The internal-signal sweep (lib/pr/discovery.ts) owns suggested=1.
 */

import { createHash, timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import { parseOpportunity } from '@/lib/pr/drafter';
import { applyPrResponsiveBump } from '@/lib/pr/responsive_bump';
import { applyTopicOverlapBump } from '@/lib/pr/topic_overlap_bump';
import {
  DEFAULT_TENANT,
  PR_EVENTS,
  type OpportunityOrigin,
  type PrSource
} from '@/lib/pr/types';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single normalized inbound item from any external lane. */
export interface RawInboundItem {
  /** The full text to parse (a journalist request, a Reddit post, an RSS item). */
  rawText: string;
  /** Optional source hint passed to the parser (e.g. 'reddit', 'qwoted'). */
  source?: PrSource | null;
  /**
   * A stable identifier from the originating system (Reddit post id, RSS guid,
   * email Message-ID). When present it anchors the dedupe hash so the same item
   * never creates a second opportunity across repeated polls/forwards. When
   * absent we hash the normalized text instead.
   */
  externalId?: string | null;
  /** Optional source URL, recorded on the ingestion-log row for traceability. */
  url?: string | null;
}

export type IngestStatus = 'parsed' | 'duplicate' | 'failed';

export interface IngestOutcome {
  status: IngestStatus;
  opportunityId: number | null;
  dedupeHash: string;
  detail?: string;
}

// Ingested external requests are real opportunities; rank them by lane trust.
// Internal-signal "ideas" carry their own relevance from discovery.ts.
const RELEVANCE_BY_ORIGIN: Record<string, number> = {
  email_inbox: 80,
  reddit: 65,
  rss: 55
};

const RAW_TEXT_MAX = 60_000;

// ---------------------------------------------------------------------------
// Shared-secret auth for the inbound webhook (mirrors lib/clay/webhook.ts).
// ---------------------------------------------------------------------------

/**
 * Constant-time check of the X-Webhook-Secret header against
 * process.env.PR_INBOUND_EMAIL_SECRET. Returns false (never throws) when the
 * env var is unset (receiver disabled), the header is missing, or the bytes
 * differ. Trims both sides so a stray newline copied from a terminal does not
 * cause a confusing 401.
 */
export function verifyPrInboundSecret(req: NextRequest): boolean {
  const expected = process.env.PR_INBOUND_EMAIL_SECRET?.trim();
  if (!expected) return false;
  const provided = req.headers.get('x-webhook-secret')?.trim();
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

/**
 * Normalize one inbound item into an opportunity. Idempotent on dedupe_hash:
 * re-ingesting the same item returns status 'duplicate' and does not create a
 * second row. Never throws -- failures are logged into pr_ingestion_log and
 * returned as status 'failed' so a bad item never breaks a batch.
 */
export async function ingestRawItem(args: {
  item: RawInboundItem;
  origin: Extract<OpportunityOrigin, 'email_inbox' | 'reddit' | 'rss'>;
  tenantId?: string;
  actorUserId?: number | null;
}): Promise<IngestOutcome> {
  const tenantId = args.tenantId ?? DEFAULT_TENANT;
  const origin = args.origin;
  const rawText = (args.item.rawText ?? '').trim();
  const dedupeHash = computeDedupeHash({
    tenantId,
    origin,
    rawText,
    externalId: args.item.externalId ?? null
  });

  const db = getAvDb();

  // 1. Record receipt up front so even a later failure is observable.
  let logId: number | null = null;
  try {
    const [r] = await db.execute<ResultSetHeader>(
      `INSERT INTO pr_ingestion_log (tenant_id, source_kind, raw_text, dedupe_hash, status)
       VALUES (?, ?, ?, ?, 'received')`,
      [tenantId, origin, rawText.slice(0, RAW_TEXT_MAX), dedupeHash]
    );
    logId = r.insertId || null;
  } catch (err) {
    console.error('[pr:ingest:log_received]', (err as Error).message);
  }

  await logEvent({
    eventType: PR_EVENTS.ingestReceived,
    userId: args.actorUserId ?? null,
    source: `pr_intake:${origin}`,
    payload: { origin, dedupe_hash: dedupeHash }
  });

  if (rawText.length < 5) {
    await finishLog(db, logId, 'failed', 'empty or too-short inbound text', null);
    return { status: 'failed', opportunityId: null, dedupeHash, detail: 'empty' };
  }

  // 2. Dedupe against an existing opportunity (uq_tenant_dedupe).
  try {
    const [dups] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM pr_opportunities WHERE tenant_id = ? AND dedupe_hash = ? LIMIT 1`,
      [tenantId, dedupeHash]
    );
    if (dups[0]?.id) {
      await finishLog(db, logId, 'duplicate', `matches opportunity ${dups[0].id}`, dups[0].id);
      await logEvent({
        eventType: PR_EVENTS.ingestDuplicate,
        userId: args.actorUserId ?? null,
        source: `pr_intake:${origin}`,
        payload: { origin, opportunity_id: dups[0].id }
      });
      return { status: 'duplicate', opportunityId: dups[0].id, dedupeHash };
    }
  } catch (err) {
    console.error('[pr:ingest:dedupe]', (err as Error).message);
  }

  // 3. Parse with the EXISTING drafter parser (matches a candidate lead, writes
  //    a strategic why_it_matters, infers source/outlet/journalist/deadline).
  let parsed;
  try {
    parsed = await parseOpportunity({
      rawText,
      sourceHint: args.item.source ?? originToSourceHint(origin),
      tenantId
    });
  } catch (err) {
    await finishLog(db, logId, 'failed', `parse error: ${(err as Error).message}`, null);
    return { status: 'failed', opportunityId: null, dedupeHash, detail: 'parse_failed' };
  }

  // 4. Insert the opportunity. ON DUPLICATE KEY guards a race on uq_tenant_dedupe
  //    (two concurrent forwards of the same digest); id=LAST_INSERT_ID(id) makes
  //    insertId resolve to the existing row in that case.
  let opportunityId: number | null = null;
  try {
    // (#199) Bump relevance when the matched client flagged themselves
    // "fast-turnaround available" on intake (pr_responsive=yes). Non-fatal:
    // helper returns the base score unchanged on any miss/error.
    const baseRelevance = RELEVANCE_BY_ORIGIN[origin] ?? 60;
    const afterResponsive = await applyPrResponsiveBump(baseRelevance, parsed.matchedLeadId);
    // (#214 v2) Bump again by overlap between the opportunity's topic_tags
    // and the matched client's intake pr_expert_topics. Free, deterministic,
    // and the only signal we have for "this client can actually speak to it."
    const relevance = await applyTopicOverlapBump(afterResponsive, parsed.matchedLeadId, parsed.topicTags ?? []);
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO pr_opportunities
         (tenant_id, source, outlet, journalist, query_text, topic_tags, why_it_matters,
          deadline, matched_lead_id, status, origin, relevance_score, suggested,
          discovered_at, dedupe_hash, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, 'new', ?, ?, 0, NOW(), ?, ?)
       ON DUPLICATE KEY UPDATE
         query_text = VALUES(query_text),
         why_it_matters = VALUES(why_it_matters),
         updated_at = NOW(),
         id = LAST_INSERT_ID(id)`,
      [
        tenantId,
        parsed.source,
        parsed.outlet,
        parsed.journalist,
        parsed.queryText,
        JSON.stringify(parsed.topicTags ?? []),
        parsed.whyItMatters,
        parsed.deadline,
        parsed.matchedLeadId,
        origin,
        relevance,
        dedupeHash,
        args.actorUserId ?? null
      ]
    );
    opportunityId = res.insertId || null;
  } catch (err) {
    await finishLog(db, logId, 'failed', `insert error: ${(err as Error).message}`, null);
    return { status: 'failed', opportunityId: null, dedupeHash, detail: 'insert_failed' };
  }

  await finishLog(db, logId, 'parsed', args.item.url ? `url: ${args.item.url}` : null, opportunityId);
  await logEvent({
    eventType: PR_EVENTS.ingestParsed,
    leadId: parsed.matchedLeadId,
    userId: args.actorUserId ?? null,
    source: `pr_intake:${origin}`,
    payload: {
      origin,
      opportunity_id: opportunityId,
      detected_source: parsed.source,
      topic_tags: parsed.topicTags ?? [],
      matched_lead_id: parsed.matchedLeadId
    }
  });

  return { status: 'parsed', opportunityId, dedupeHash };
}

/** Convenience: ingest a batch sequentially, returning a per-item + summary view. */
export async function ingestBatch(args: {
  items: RawInboundItem[];
  origin: Extract<OpportunityOrigin, 'email_inbox' | 'reddit' | 'rss'>;
  tenantId?: string;
  actorUserId?: number | null;
  cap?: number;
}): Promise<{
  received: number;
  processed: number;
  parsed: number;
  duplicate: number;
  failed: number;
  results: IngestOutcome[];
}> {
  const cap = Math.max(1, Math.min(args.cap ?? 25, 100));
  const slice = args.items.slice(0, cap);
  const results: IngestOutcome[] = [];
  for (const item of slice) {
    results.push(
      await ingestRawItem({
        item,
        origin: args.origin,
        tenantId: args.tenantId,
        actorUserId: args.actorUserId
      })
    );
  }
  return {
    received: args.items.length,
    processed: slice.length,
    parsed: results.filter((r) => r.status === 'parsed').length,
    duplicate: results.filter((r) => r.status === 'duplicate').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeDedupeHash(args: {
  tenantId: string;
  origin: string;
  rawText: string;
  externalId: string | null;
}): string {
  if (args.externalId && args.externalId.trim()) {
    return sha256(`${args.tenantId}:${args.origin}:${args.externalId.trim()}`);
  }
  // Normalize whitespace + case so trivial reformatting does not defeat dedupe.
  const norm = args.rawText.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 2000);
  return sha256(`${args.tenantId}:${norm}`);
}

async function finishLog(
  db: ReturnType<typeof getAvDb>,
  logId: number | null,
  status: IngestStatus,
  detail: string | null,
  opportunityId: number | null
): Promise<void> {
  if (logId == null) return;
  try {
    await db.execute<ResultSetHeader>(
      `UPDATE pr_ingestion_log
          SET status = ?, detail = ?, parsed_opportunity_id = ?
        WHERE id = ?`,
      [status, detail ? detail.slice(0, 500) : null, opportunityId, logId]
    );
  } catch (err) {
    console.error('[pr:ingest:log_finish]', (err as Error).message);
  }
}

function originToSourceHint(
  origin: 'email_inbox' | 'reddit' | 'rss'
): PrSource | null {
  // For the email inbox we let the parser infer the platform from the digest
  // text (it recognizes qwoted/featured/sourcebottle/etc). Reddit/RSS are known.
  if (origin === 'reddit') return 'reddit';
  if (origin === 'rss') return 'other';
  return null;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
