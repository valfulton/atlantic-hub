/**
 * POST /api/admin/av/enrich
 *
 * Manual-trigger enrichment endpoint. Called by the "Enrich next N" button
 * on /admin/av. Same business logic also runs from a Netlify scheduled
 * function (netlify/functions/enrich-cron.ts) — both call into
 * lib/enrichment/enricher.ts.
 *
 * Body: { limit?: number }  (default 5, max 50)
 *
 * Returns: EnrichmentBatchSummary (see lib/enrichment/enricher.ts) with an
 * additional `suggestedNextAction` field hinting whether the operator
 * should kick off cold-email outreach to the just-enriched leads.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { runEnrichmentBatch, type EnrichmentTriggerSource } from '@/lib/enrichment/enricher';

export const runtime = 'nodejs';
export const maxDuration = 60; // up to 60s — Hunter calls + 1.1s between can take a while

/**
 * Auth: either
 *   (a) admin session cookie (manual trigger from the UI), OR
 *   (b) X-Cron-Secret header matching ENRICHMENT_CRON_SECRET env var
 *       (the Netlify scheduled function path)
 * Both paths require tab_av_enabled to be ON.
 */
export async function POST(req: NextRequest) {
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  // ---------- Path B: cron-secret header ----------
  const cronSecret = process.env.ENRICHMENT_CRON_SECRET;
  const incomingCronSecret = req.headers.get('x-cron-secret');
  const cronAuthorized =
    !!cronSecret && !!incomingCronSecret && cronSecret === incomingCronSecret;

  // ---------- Path A: admin cookie ----------
  let adminAuthorized = false;
  if (!cronAuthorized) {
    const guard = await guardAdminRequest(req, {
      targetResource: '/api/admin/av/enrich',
      tenantId: 'av'
    });
    if (!guard.ok) return guard.response;
    if (guard.actor.role === 'client_user') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    adminAuthorized = true;
  }

  if (!cronAuthorized && !adminAuthorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const triggerSource: EnrichmentTriggerSource = cronAuthorized ? 'cron' : 'manual';

  let payload: { limit?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    // empty body is fine — use defaults
  }

  const limit =
    typeof payload.limit === 'number' && Number.isFinite(payload.limit)
      ? Math.max(1, Math.min(50, Math.floor(payload.limit)))
      : 5;

  try {
    const summary = await runEnrichmentBatch({
      limit,
      triggerSource
    });

    // After a successful enrichment batch, suggest the next operator action.
    // Email outreach is a future feature; for now we hint at it so the UI
    // can show a "coming soon" modal asking if Val wants to queue an
    // outreach series for the just-enriched leads.
    const suggestedNextAction =
      summary.enriched > 0
        ? 'send_outreach_email_series'
        : summary.stoppedEarlyReason
        ? null
        : 'review_results';

    return NextResponse.json({ ...summary, suggestedNextAction });
  } catch (err) {
    console.error('[av:enrich:post]', (err as Error).message);
    return NextResponse.json(
      { error: 'enrichment_run_failed', errorClass: (err as Error).name, message: (err as Error).message },
      { status: 500 }
    );
  }
}
