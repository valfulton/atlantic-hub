/**
 * POST /api/admin/av/pain-sweep
 *
 * Run the pain-extractor sweep. Picks leads with no pain_point_profile
 * OR a stale one (>14 days), extracts a fresh structured pain profile
 * via OpenAI. Same dual-auth pattern as score-sweep: admin cookie or
 * X-Cron-Secret header.
 *
 * Body: { limit?: number } default 25, max 50.
 *
 * Soft 55-second deadline so the function returns gracefully if a batch
 * runs long.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { extractPainProfileForLead, pickPainCandidates } from '@/lib/ai/pain_extractor';
import { logEvent } from '@/lib/events/log';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DEFAULT_BATCH = 25;
const MAX_BATCH = 50;
const SOFT_DEADLINE_MS = 55_000;

export async function POST(req: NextRequest) {
  const cronSecret = process.env.ENRICHMENT_CRON_SECRET;
  const incomingCronSecret = req.headers.get('x-cron-secret');
  const cronAuthorized = !!cronSecret && !!incomingCronSecret && cronSecret === incomingCronSecret;

  let actorUserId: number | null = null;
  if (!cronAuthorized) {
    const guard = await guardAdminRequest(req, {
      targetResource: '/api/admin/av/pain-sweep',
      tenantId: 'av'
    });
    if (!guard.ok) return guard.response;
    if (guard.actor.role === 'client_user') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    actorUserId = guard.actor.userId;
  }

  let payload: { limit?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    // empty body OK
  }
  const limit = Math.min(
    MAX_BATCH,
    Math.max(
      1,
      typeof payload.limit === 'number' && Number.isFinite(payload.limit) ? Math.floor(payload.limit) : DEFAULT_BATCH
    )
  );

  const triggerSource = cronAuthorized ? 'cron' : 'manual';
  const start = Date.now();

  let candidateIds: number[] = [];
  try {
    candidateIds = await pickPainCandidates(limit);
  } catch (err) {
    await logEvent({
      eventType: 'pain.sweep_error',
      source: 'cron',
      status: 'failure',
      payload: { stage: 'select_candidates', trigger_source: triggerSource },
      errorMessage: (err as Error).message.slice(0, 500)
    });
    return NextResponse.json({ error: 'candidate_select_failed' }, { status: 500 });
  }

  let extracted = 0;
  let skipped = 0;
  let failed = 0;
  let stoppedEarly = false;

  for (const id of candidateIds) {
    if (Date.now() - start > SOFT_DEADLINE_MS) {
      stoppedEarly = true;
      break;
    }
    try {
      const result = await extractPainProfileForLead(id);
      if (result === null) skipped += 1;
      else extracted += 1;
    } catch (err) {
      failed += 1;
      console.error('[pain-sweep:lead]', id, (err as Error).message);
    }
  }

  const elapsedMs = Date.now() - start;
  await logEvent({
    eventType: 'pain.sweep_run',
    userId: actorUserId,
    source: 'cron',
    status: failed > 0 && extracted === 0 ? 'failure' : stoppedEarly ? 'partial' : 'success',
    payload: {
      trigger_source: triggerSource,
      attempted: candidateIds.length,
      extracted,
      skipped,
      failed,
      stopped_early: stoppedEarly,
      limit_requested: limit
    },
    executionTimeMs: elapsedMs
  });

  return NextResponse.json({
    ok: true,
    triggerSource,
    elapsedMs,
    attempted: candidateIds.length,
    extracted,
    skipped,
    failed,
    stoppedEarly
  });
}
