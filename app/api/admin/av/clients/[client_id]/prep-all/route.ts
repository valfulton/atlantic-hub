/**
 * POST /api/admin/av/clients/[client_id]/prep-all  (#353, val 2026-06-02)
 *
 * One-click "light them all up" for a client. Chains the existing prep actions
 * in safe order, blanks-only, so val's hand-curated values are NEVER touched:
 *
 *   1. Fill intake from web (LLM-suggested intake fields from their site)
 *   2. Extract brand kit (colors + logo + aesthetic + typography)
 *   3. Sharpen ICP (industries / geographies / sizes from the now-fuller brief)
 *   4. Extract intelligence from intake (canonical intelligence_objects)
 *   5. Scrape socials from the brand's website (auto-suggest social_targets)
 *
 * Each step is independently try/catch'd: a failure in one step doesn't block
 * the others. Returns a summary so val sees what ran, what was already done,
 * what failed.
 *
 * Body: { websiteUrl?: string } — override the brief's saved URL.
 * Owner / staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { getBriefPayload, saveBriefPayload } from '@/lib/client/brief_store';
import { suggestIntakeFromUrl } from '@/lib/client/intake_web_filler';
import {
  maybeExtractBrandKitAfterBriefSave,
  maybeSharpenIcpAfterBriefSave
} from '@/lib/client/autopilot';
import { extractIntakeIntelligence } from '@/lib/client/intake_extract';
import { proposeLinesFromIntake } from '@/lib/campaigns/propose_lines';
import { scrapeAndSuggestForBrand } from '@/lib/social/targets';
import { runPrepPreflight } from '@/lib/av/prep_preflight';

export const runtime = 'nodejs';
// Web fetches + 2 LLM calls in sequence; cap at the platform max.
export const maxDuration = 60;

type StepStatus = 'ok' | 'skipped' | 'failed' | 'pre_skipped';

interface StepResult {
  step: string;
  status: StepStatus;
  detail?: string;
  /** (#367) Per-step LLM cost — set by the post-run llm_call_log roll-up. */
  costMicrocents?: number;
  /** (#367) `live` if a real call fired, `cache` if served from cache, undefined for non-LLM steps. */
  costSource?: 'live' | 'cache' | null;
}

function ok(step: string, detail?: string): StepResult { return { step, status: 'ok', detail }; }
function skipped(step: string, detail: string): StepResult { return { step, status: 'skipped', detail }; }
function preSkipped(step: string, reason: string): StepResult { return { step, status: 'pre_skipped', detail: reason }; }
function failed(step: string, err: unknown): StepResult {
  const msg = err instanceof Error ? err.message.slice(0, 280) : String(err).slice(0, 280);
  return { step, status: 'failed', detail: msg };
}

/** (#367) Map our step ids ↔ the task_kind that each step's LLM call logs as,
 *  so we can fan the per-step cost back out of llm_call_log after the run. */
const STEP_TO_TASK_KIND: Record<string, string> = {
  fill_intake: 'intake_web_fill',
  brand_kit: 'brand_kit_extract',
  sharpen_icp: 'icp_sharpen',
  extract_intel: 'intake_intel_extract',
  narrative_lines: 'narrative_line_propose'
  // socials_scrape: no LLM call (pure HTML scrape)
};

function pickWebsiteUrl(
  bodyUrl: string | null | undefined,
  briefPayload: Record<string, unknown> | null
): string | null {
  const raw =
    (typeof bodyUrl === 'string' && bodyUrl.trim()) ||
    (briefPayload && typeof briefPayload.website_url === 'string' && (briefPayload.website_url as string).trim()) ||
    (briefPayload && typeof briefPayload.websiteUrl === 'string' && (briefPayload.websiteUrl as string).trim()) ||
    (briefPayload && typeof briefPayload.website === 'string' && (briefPayload.website as string).trim()) ||
    '';
  if (!raw) return null;
  // Tolerate "cldaservices.com" without scheme.
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/prep-all:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: { websiteUrl?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body fine */
  }

  const briefPayloadRaw = await getBriefPayload('av', clientId);
  const briefPayload = (briefPayloadRaw as Record<string, unknown> | null) ?? {};
  const websiteUrl = pickWebsiteUrl(typeof body.websiteUrl === 'string' ? body.websiteUrl : null, briefPayload);

  // (#358) Pre-flight FIRST — free checks before any paid LLM call. Steps
  // that would fail or run on garbage are pre_skipped, never firing the LLM.
  // Has any client_user got an intake_payload? (cheap one-shot query)
  let hasIntakePayload = false;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(import('mysql2').RowDataPacket & { intake_payload: unknown })[]>(
      `SELECT intake_payload FROM client_users WHERE client_id = ? AND intake_payload IS NOT NULL LIMIT 1`,
      [clientId]
    );
    if (rows[0]?.intake_payload) {
      const p = typeof rows[0].intake_payload === 'string' ? JSON.parse(rows[0].intake_payload) : rows[0].intake_payload;
      if (p && Object.keys(p).length > 0) hasIntakePayload = true;
    }
  } catch { /* non-fatal */ }

  const preflight = await runPrepPreflight({ url: websiteUrl, briefPayload, hasIntakePayload });

  // Timestamp used to scope the final llm_call_log cost rollup to JUST this run.
  const prepStarted = new Date();

  const results: StepResult[] = [];

  // -------- Step 1: Fill intake from web ----------------------------------
  if (!preflight.steps.fill_intake.ok) {
    results.push(preSkipped('fill_intake', preflight.steps.fill_intake.reason));
  } else if (!websiteUrl) {
    results.push(skipped('fill_intake', 'No website URL on brief or in request'));
  } else {
    try {
      const sug = await suggestIntakeFromUrl({ url: websiteUrl, brandHint: null, clientId });
      // Apply all proposed values blanks-only: respect any field val curated.
      const patch: Record<string, string> = {};
      for (const [k, v] of Object.entries(sug.suggestions || {})) {
        if (typeof v !== 'string' || !v.trim()) continue;
        // Skip if there's already a non-empty value in the brief.
        const existing = (briefPayload as Record<string, unknown>)[k];
        if (typeof existing === 'string' && existing.trim().length > 0) continue;
        if (Array.isArray(existing) && existing.length > 0) continue;
        patch[k] = v.slice(0, 4000);
      }
      const keysWritten = Object.keys(patch);
      if (keysWritten.length > 0) {
        await saveBriefPayload('av', clientId, patch, {
          changedBy: guard.actor.userId ? String(guard.actor.userId) : null,
          source: 'web_filler_apply'
        });
        results.push(ok('fill_intake', `Filled ${keysWritten.length} blank field${keysWritten.length === 1 ? '' : 's'}`));
      } else {
        results.push(skipped('fill_intake', 'Brief already covered — nothing to fill'));
      }
    } catch (e) {
      results.push(failed('fill_intake', e));
    }
  }

  // -------- Step 2: Brand kit extract -------------------------------------
  // Autopilot helper reads brief.website_url, fetches the page, runs the LLM,
  // and persists the kit blanks-only. If brand_colors is already populated it
  // skips silently — perfect for val's "rerun whenever" intent.
  if (!preflight.steps.brand_kit.ok) {
    results.push(preSkipped('brand_kit', preflight.steps.brand_kit.reason));
  } else try {
    await maybeExtractBrandKitAfterBriefSave({ clientId });
    // Re-read brief to report what's there now.
    const after = (await getBriefPayload('av', clientId)) as Record<string, unknown> | null;
    const colors = after?.brand_colors;
    const colorCount =
      typeof colors === 'string'
        ? colors.split(/[,\s]+/).filter(Boolean).length
        : Array.isArray(colors) ? colors.length : 0;
    if (colorCount > 0 || after?.logo_url) {
      results.push(ok('brand_kit', `${colorCount} color${colorCount === 1 ? '' : 's'}${after?.logo_url ? ' · logo' : ''}`));
    } else {
      results.push(skipped('brand_kit', 'No colors extracted from page'));
    }
  } catch (e) {
    results.push(failed('brand_kit', e));
  }

  // -------- Step 3: Sharpen ICP -------------------------------------------
  if (!preflight.steps.sharpen_icp.ok) {
    results.push(preSkipped('sharpen_icp', preflight.steps.sharpen_icp.reason));
  } else try {
    await maybeSharpenIcpAfterBriefSave({ clientId, source: 'prep_all' });
    results.push(ok('sharpen_icp', 'ICP auto-sharpener ran'));
  } catch (e) {
    results.push(failed('sharpen_icp', e));
  }

  // -------- Step 4: Extract intelligence from intake ----------------------
  if (!preflight.steps.extract_intel.ok) {
    results.push(preSkipped('extract_intel', preflight.steps.extract_intel.reason));
  } else try {
    const intel = await extractIntakeIntelligence({ clientId, actorUserId: guard.actor.userId ?? null });
    const written = intel.written ?? 0;
    const detail = intel.reason === 'no_intake'
      ? 'No intake yet — nothing to extract'
      : `${written} intelligence object${written === 1 ? '' : 's'}`;
    results.push(intel.reason === 'no_intake' ? skipped('extract_intel', detail) : ok('extract_intel', detail));

    // Propose narrative-line candidates from intake (no-op if lines already exist).
    if (intel.reason !== 'no_intake') {
      try {
        const p = await proposeLinesFromIntake({ clientId });
        if (p.proposed > 0) results.push(ok('narrative_lines', `${p.proposed} candidate${p.proposed === 1 ? '' : 's'}`));
        else results.push(skipped('narrative_lines', 'Already has lines or none proposed'));
      } catch (e) {
        results.push(failed('narrative_lines', e));
      }
    }
  } catch (e) {
    results.push(failed('extract_intel', e));
  }

  // -------- Step 5: Scrape socials from the brand's website ---------------
  if (!preflight.steps.scrape_socials.ok) {
    results.push(preSkipped('socials_scrape', preflight.steps.scrape_socials.reason));
  } else if (!websiteUrl) {
    results.push(skipped('socials_scrape', 'No website URL'));
  } else {
    try {
      const sc = await scrapeAndSuggestForBrand(clientId, websiteUrl, guard.actor.userId ?? null);
      if (sc.found > 0) {
        results.push(ok('socials_scrape', `Found ${sc.found} · saved ${sc.saved}${sc.skipped > 0 ? ` · ${sc.skipped} already on file` : ''}`));
      } else {
        results.push(skipped('socials_scrape', 'No socials linked from page footer'));
      }
    } catch (e) {
      results.push(failed('socials_scrape', e));
    }
  }

  const okCount = results.filter((r) => r.status === 'ok').length;
  const failedCount = results.filter((r) => r.status === 'failed').length;
  const preSkippedCount = results.filter((r) => r.status === 'pre_skipped').length;

  // (#361) Total LLM cost for this Prep run — query llm_call_log for the rows
  // we just generated. Bound by the prep_started timestamp + this client_id so
  // we don't pick up unrelated calls.
  let totalCostMicrocents = 0;
  let totalLiveMicrocents = 0;
  let totalCacheSavedMicrocents = 0;
  let liveCallCount = 0;
  let cacheHitCount = 0;
  try {
    const db = getAvDb();
    const [costRows] = await db.execute<(import('mysql2').RowDataPacket & {
      total_live: number | string | null;
      total_cache_saved: number | string | null;
      live_calls: number | string;
      cache_hits: number | string;
    })[]>(
      `SELECT
         SUM(CASE WHEN source='live' THEN cost_microcents ELSE 0 END) AS total_live,
         SUM(CASE WHEN source='cache' THEN
           /* cost the live call WOULD have been; we don't have that here, so
              estimate from cached metadata in a follow-up. For now report 0. */
           0 ELSE 0 END) AS total_cache_saved,
         SUM(CASE WHEN source='live' THEN 1 ELSE 0 END) AS live_calls,
         SUM(CASE WHEN source='cache' THEN 1 ELSE 0 END) AS cache_hits
       FROM llm_call_log
       WHERE client_id = ? AND ts >= ?`,
      [clientId, prepStarted]
    );
    if (costRows[0]) {
      totalLiveMicrocents = Number(costRows[0].total_live ?? 0);
      totalCacheSavedMicrocents = Number(costRows[0].total_cache_saved ?? 0);
      liveCallCount = Number(costRows[0].live_calls ?? 0);
      cacheHitCount = Number(costRows[0].cache_hits ?? 0);
      totalCostMicrocents = totalLiveMicrocents;
    }

    // (#367) Per-step cost: group log rows by task_kind for this run and fan
    // them back into the matching StepResult so val sees which step spent
    // what (and which steps came in free from cache).
    const [perKindRows] = await db.execute<(import('mysql2').RowDataPacket & {
      task_kind: string;
      live_microcents: number | string | null;
      live_calls: number | string;
      cache_hits: number | string;
    })[]>(
      `SELECT
         task_kind,
         SUM(CASE WHEN source='live' THEN cost_microcents ELSE 0 END) AS live_microcents,
         SUM(CASE WHEN source='live' THEN 1 ELSE 0 END) AS live_calls,
         SUM(CASE WHEN source='cache' THEN 1 ELSE 0 END) AS cache_hits
       FROM llm_call_log
       WHERE client_id = ? AND ts >= ?
       GROUP BY task_kind`,
      [clientId, prepStarted]
    );
    const costByTaskKind = new Map<string, { live: number; liveCalls: number; cacheHits: number }>();
    for (const r of perKindRows) {
      costByTaskKind.set(String(r.task_kind), {
        live: Number(r.live_microcents ?? 0),
        liveCalls: Number(r.live_calls ?? 0),
        cacheHits: Number(r.cache_hits ?? 0)
      });
    }
    for (const r of results) {
      const taskKind = STEP_TO_TASK_KIND[r.step];
      if (!taskKind) continue;
      const c = costByTaskKind.get(taskKind);
      if (!c) continue;
      r.costMicrocents = c.live;
      // Live wins over cache for the source label if the step did both.
      r.costSource = c.liveCalls > 0 ? 'live' : c.cacheHits > 0 ? 'cache' : null;
    }
  } catch { /* non-fatal */ }

  return NextResponse.json({
    ok: true,
    websiteUrl,
    okCount,
    failedCount,
    preSkippedCount,
    /** (#358) Per-step readiness from pre-flight, surfaced to the UI so val sees
     *  "URL 404 → skipped 3 LLM calls" rather than failed attempts after charges. */
    preflight,
    /** (#361) Total cost + cache stats for this prep run. */
    totalCostMicrocents,
    liveCallCount,
    cacheHitCount,
    results
  });
}
