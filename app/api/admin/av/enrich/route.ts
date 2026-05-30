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
  let actorRole: 'owner' | 'staff' | 'client_user' | null = null;
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
    actorRole = guard.actor.role;
  }

  if (!cronAuthorized && !adminAuthorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const triggerSource: EnrichmentTriggerSource = cronAuthorized ? 'cron' : 'manual';

  let payload: { limit?: unknown; monthlyCeilingOverride?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    // empty body is fine — use defaults
  }

  const limit =
    typeof payload.limit === 'number' && Number.isFinite(payload.limit)
      ? Math.max(1, Math.min(50, Math.floor(payload.limit)))
      : 5;

  // (#250) Owner-only ceiling override. Only honored when the actor role is
  // 'owner' — staff sends are silently ignored. Bounded 1..1000 to prevent a
  // typo from authorizing a runaway batch. Cron-trigger NEVER takes an
  // override; the cron is supposed to respect the env-configured ceiling.
  let monthlyCeilingOverride: number | undefined;
  if (
    actorRole === 'owner' &&
    typeof payload.monthlyCeilingOverride === 'number' &&
    Number.isFinite(payload.monthlyCeilingOverride)
  ) {
    const n = Math.floor(payload.monthlyCeilingOverride);
    if (n >= 1 && n <= 1000) monthlyCeilingOverride = n;
  }

  try {
    const summary = await runEnrichmentBatch({
      limit,
      triggerSource,
      ...(monthlyCeilingOverride !== undefined ? { monthlyCeiling: monthlyCeilingOverride } : {})
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
