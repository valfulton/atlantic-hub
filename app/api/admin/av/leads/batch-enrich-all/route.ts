/**
 * POST /api/admin/av/leads/batch-enrich-all  (#278)
 *
 * The bulk version of the per-lead Enrich-from-sources menu. val asked for
 * this all day: she wants to hit ONE button on /admin/av and have 5-25
 * leads enriched across Smart enrich + Google Places + Instagram + WHOIS
 * at the same time, instead of clicking into each lead and running the
 * sources one-by-one. Hunter has its own button (POST /api/admin/av/enrich)
 * and is NOT included here — it bills credits and val burns them faster
 * than she gets value, so this route deliberately skips Hunter.
 *
 * Body: { limit?: number, sources?: ('smart'|'places'|'instagram'|'whois')[] }
 *   limit   — how many leads to process (1..25, default 5)
 *   sources — which enrichers to run on each lead (default: all four)
 *
 * Selection: the next N active, non-converted leads ordered by the staler
 * of last_activity_at / submission_date. Smart skips leads with no website
 * (it needs one). Places needs a company. IG needs company OR website.
 * WHOIS needs a website. Each source's own guard lets us skip cheaply.
 *
 * Returns: per-source filled-field counts + per-lead row summary so val
 * sees exactly what landed where. Same shape as the per-lead menu's reply,
 * just aggregated across N leads.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { enrichLeadFromSmartScrape } from '@/lib/scraper/smart_lead_scraper';
import { enrichLeadFromPlaces } from '@/lib/google_places/discoverer';
import { enrichLeadFromInstagram } from '@/lib/apify/discoverer';
import { enrichLeadFromWhois } from '@/lib/whois/enrich';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

type SourceKey = 'smart' | 'places' | 'instagram' | 'whois';
const ALL_SOURCES: SourceKey[] = ['smart', 'places', 'instagram', 'whois'];

interface LeadRow extends RowDataPacket {
  id: number;
  audit_id: string;
  company: string | null;
  website: string | null;
}

interface PerLeadOutcome {
  leadId: number;
  auditId: string;
  company: string | null;
  smart?: { filled: number; reason: string | null };
  places?: { filled: number; reason: string | null };
  instagram?: { filled: number; reason: string | null };
  whois?: { filled: number; reason: string | null };
}

// (#280 polish) Outer try/catch wrapper so that an unexpected throw (a typo
// in one of the source libs, an env-var-missing crash on cold start, etc.)
// returns JSON with the actual error message to the browser instead of a
// bare HTTP 500 with no body. The previous version left val staring at a
// 500 with no way to tell what broke.
export async function POST(req: NextRequest) {
  try {
    return await runBatch(req);
  } catch (err) {
    console.error('[batch-enrich-all:fatal]', (err as Error).message, (err as Error).stack);
    return NextResponse.json(
      {
        error: 'batch_enrich_fatal',
        message: (err as Error).message || 'unknown error',
        errorClass: (err as Error).name || 'Error'
      },
      { status: 500 }
    );
  }
}

async function runBatch(req: NextRequest): Promise<NextResponse> {
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/batch-enrich-all:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Parse body
  let body: { limit?: unknown; sources?: unknown; auditIds?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body OK */
  }
  const limit =
    typeof body.limit === 'number' && Number.isFinite(body.limit)
      ? Math.max(1, Math.min(25, Math.floor(body.limit)))
      : 5;
  const sources: SourceKey[] =
    Array.isArray(body.sources) && body.sources.length > 0
      ? (body.sources.filter((s): s is SourceKey => ALL_SOURCES.includes(s as SourceKey)) as SourceKey[])
      : ALL_SOURCES;

  // (#279) When the client passes explicit auditIds (the cockpit sends the
  // first N visible row IDs from its current filter), the batch enriches
  // EXACTLY those leads — so val gets what she's looking at, not some
  // arbitrary "stalest" auto-pick. Empty / missing falls back to the
  // ORDER BY ... LIMIT path below.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const auditIds: string[] = Array.isArray(body.auditIds)
    ? body.auditIds.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)).slice(0, limit)
    : [];
  const useExplicitIds = auditIds.length > 0;

  // Pick the N leads to enrich. Two modes:
  //   useExplicitIds → fetch the rows for the audit_ids val sent, preserving
  //     her order. This is the "enrich the leads I'm looking at" mode.
  //   otherwise     → pick the N stalest active leads (legacy fallback).
  // LIMIT is inlined (not parameterized) because mysql2 prepared statements
  // reject ? in LIMIT on our setup. `limit` is validated 1..25 above.
  const db = getAvDb();
  let rows: LeadRow[] = [];
  try {
    if (useExplicitIds) {
      // Build a placeholder list for IN (?, ?, ?) and preserve val's order
      // using FIELD(audit_id, ...) so the result panel matches her table.
      const placeholders = auditIds.map(() => '?').join(', ');
      const [r] = await db.execute<LeadRow[]>(
        `SELECT id, audit_id, company, website
           FROM leads
          WHERE audit_id IN (${placeholders})
            AND archived_at IS NULL
          ORDER BY FIELD(audit_id, ${placeholders})`,
        [...auditIds, ...auditIds]
      );
      rows = r;
    } else {
      const [r] = await db.execute<LeadRow[]>(
        `SELECT id, audit_id, company, website
           FROM leads
          WHERE archived_at IS NULL
            AND lead_status NOT IN ('converted', 'lost')
          ORDER BY (contact_name IS NULL OR contact_name = '') DESC,
                   COALESCE(last_activity_at, submission_date) ASC
          LIMIT ${limit}`
      );
      rows = r;
    }
  } catch (err) {
    console.error('[batch-enrich-all:select]', (err as Error).message);
    return NextResponse.json(
      { error: 'lead_select_failed', message: (err as Error).message },
      { status: 500 }
    );
  }

  // Per-source aggregate counters. `attempted` = times we even called the
  // source for some lead; `filled` = total fields written across the batch;
  // `errored` = soft failures (lead had no website, no company match, etc).
  const perSource: Record<SourceKey, { attempted: number; filled: number; errored: number }> = {
    smart: { attempted: 0, filled: 0, errored: 0 },
    places: { attempted: 0, filled: 0, errored: 0 },
    instagram: { attempted: 0, filled: 0, errored: 0 },
    whois: { attempted: 0, filled: 0, errored: 0 }
  };
  const perLead: PerLeadOutcome[] = [];

  // (#280) Sequential per lead, but PARALLEL per source for that lead.
  // Earlier version ran every source sequentially → for 5 leads × 4 sources
  // (~16s/lead) the function blew past Netlify's 60s timeout (HTTP 504).
  // Running the 4 sources in parallel per lead caps each lead at the
  // longest source (~5-10s instead of summing to ~16s).
  //
  // Plus a global 50s deadline (10s headroom under maxDuration=60s) — if
  // the next lead would push us past 50s of wall-clock work we stop and
  // return what completed instead of letting the function time out and
  // losing the partial-result body. Anything not processed is noted in
  // the response so val can re-run on what's left.
  // (#280 v2) Netlify killed the function before my 50s deadline could fire
  // — the actual platform timeout on val's plan is well below the 60s
  // maxDuration I requested. Shrinking to 25s total / 7s per source so we
  // fit regardless of plan tier. Trade-off: smaller default batch (3
  // instead of 5), but actually returns a result instead of HTTP 504.
  const BATCH_DEADLINE_MS = 25_000;
  const startTime = Date.now();
  const elapsed = () => Date.now() - startTime;
  let stoppedEarlyReason: string | null = null;

  function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms)
      )
    ]);
  }
  const PER_SOURCE_MS = 7_000; // hard ceiling per source per lead

  for (const lead of rows) {
    if (elapsed() > BATCH_DEADLINE_MS) {
      stoppedEarlyReason = `Stopped at ${perLead.length}/${rows.length} leads to stay under the function timeout. Click again to continue with the rest.`;
      break;
    }

    const outcome: PerLeadOutcome = {
      leadId: lead.id,
      auditId: lead.audit_id,
      company: lead.company
    };

    // Build one async task per requested source for THIS lead. Each task
    // returns a `{src, filled, reason}` triple — never throws (wrapped in
    // try/catch) so Promise.all doesn't short-circuit on a single bad
    // source. We then fold each result into perSource + outcome.
    type SourceResult = { src: SourceKey; filled: number; reason: string | null; errored: boolean; attempted: boolean };
    const tasks: Promise<SourceResult>[] = sources.map(async (src): Promise<SourceResult> => {
      try {
        if (src === 'smart') {
          if (!lead.website || !lead.website.trim()) {
            return { src, filled: 0, reason: 'no website on file', errored: true, attempted: false };
          }
          const r = await withTimeout(
            enrichLeadFromSmartScrape({ leadId: lead.id, websiteUrl: lead.website, brandHint: lead.company }),
            PER_SOURCE_MS,
            'smart'
          );
          const filled = r.enrichment?.filled ?? 0;
          return { src, filled, reason: r.reason, errored: !r.fetched && filled === 0, attempted: true };
        }
        if (src === 'places') {
          if (!lead.company || !lead.company.trim()) {
            return { src, filled: 0, reason: 'no company name on file', errored: true, attempted: false };
          }
          const r = await withTimeout(
            enrichLeadFromPlaces({ leadId: lead.id, actorUserId: guard.actor.userId }),
            PER_SOURCE_MS,
            'places'
          );
          if (r.ok) return { src, filled: r.filled ?? 0, reason: null, errored: false, attempted: true };
          return { src, filled: 0, reason: r.reason ?? 'no match', errored: true, attempted: true };
        }
        if (src === 'instagram') {
          if ((!lead.company || !lead.company.trim()) && (!lead.website || !lead.website.trim())) {
            return { src, filled: 0, reason: 'no company or website on file', errored: true, attempted: false };
          }
          const r = await withTimeout(
            enrichLeadFromInstagram({ leadId: lead.id, actorUserId: guard.actor.userId }),
            PER_SOURCE_MS,
            'instagram'
          );
          if (r.ok) return { src, filled: r.filled ?? 0, reason: null, errored: false, attempted: true };
          return { src, filled: 0, reason: r.reason ?? 'no profile', errored: true, attempted: true };
        }
        // whois
        if (!lead.website || !lead.website.trim()) {
          return { src, filled: 0, reason: 'no website on file', errored: true, attempted: false };
        }
        const r = await withTimeout(
          enrichLeadFromWhois({ leadId: lead.id, actorUserId: guard.actor.userId }),
          PER_SOURCE_MS,
          'whois'
        );
        if (r.ok) return { src, filled: r.filled ?? 0, reason: null, errored: false, attempted: true };
        return { src, filled: 0, reason: r.reason ?? 'WHOIS unavailable', errored: true, attempted: true };
      } catch (err) {
        return { src, filled: 0, reason: (err as Error).message || 'unexpected error', errored: true, attempted: true };
      }
    });

    const results = await Promise.all(tasks);
    for (const r of results) {
      if (r.attempted) perSource[r.src].attempted += 1;
      perSource[r.src].filled += r.filled;
      if (r.errored) perSource[r.src].errored += 1;
      outcome[r.src] = { filled: r.filled, reason: r.reason };
    }

    perLead.push(outcome);
  }

  return NextResponse.json({
    ok: true,
    leadsProcessed: perLead.length,
    leadsRequested: rows.length,
    stoppedEarlyReason,
    elapsedMs: elapsed(),
    sourcesRun: sources,
    perSource,
    perLead
  });
}
