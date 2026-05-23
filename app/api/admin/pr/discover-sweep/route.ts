/**
 * POST /api/admin/pr/discover-sweep
 *
 * The autonomous PR discovery cadence. One call runs BOTH lanes the engine
 * already has and upserts SUGGESTED pr_opportunities + strengthens
 * intelligence_objects, idempotently (dedupe_hash upserts, no duplicates):
 *   - runInternalDiscoverySweep: pain-cluster + standout-lead signals from data
 *     the hub already holds (no external API, no AI cost).
 *   - runExternalDiscovery: the configured Reddit/RSS lanes (pr_discovery_sources)
 *     + the outreach-performance sweep (what is actually converting).
 *
 * Auth: dual-mode, identical to /api/admin/av/score-sweep:
 *   (a) X-Cron-Secret header == ENRICHMENT_CRON_SECRET  (scheduled Netlify fn), OR
 *   (b) admin session cookie (manual "Find opportunities" trigger from the desk).
 *
 * This path is listed in middleware PUBLIC_WEBHOOK_PATHS so the cron (which has
 * no operator session cookie) reaches the handler; the secret check below is the
 * real gate. Emits pr.discovery.swept into system_events.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { runInternalDiscoverySweep } from '@/lib/pr/discovery';
import { runExternalDiscovery } from '@/lib/pr/sources/run';
import { logEvent } from '@/lib/events/log';
import { DEFAULT_TENANT, PR_EVENTS } from '@/lib/pr/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // ---------- Path B: cron-secret header (reuses ENRICHMENT_CRON_SECRET) ----------
  const cronSecret = process.env.ENRICHMENT_CRON_SECRET;
  const incomingCronSecret = req.headers.get('x-cron-secret');
  const cronAuthorized = !!cronSecret && !!incomingCronSecret && cronSecret === incomingCronSecret;

  // ---------- Path A: admin session cookie (manual trigger) ----------
  let actorUserId: number | null = null;
  if (!cronAuthorized) {
    const guard = await guardAdminRequest(req, {
      targetResource: '/api/admin/pr/discover-sweep',
      tenantId: 'av'
    });
    if (!guard.ok) return guard.response;
    if (guard.actor.role === 'client_user') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    actorUserId = guard.actor.userId;
  }

  let body: { tenantId?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // empty body OK
  }
  const tenantId =
    typeof body.tenantId === 'string' && body.tenantId ? body.tenantId.slice(0, 64) : DEFAULT_TENANT;

  const triggerSource = cronAuthorized ? 'cron' : 'manual';
  const start = Date.now();

  // Each sweep is internally fire-safe (never throws out), but wrap anyway so one
  // lane failing never aborts the other.
  let internal: Awaited<ReturnType<typeof runInternalDiscoverySweep>> | null = null;
  let external: Awaited<ReturnType<typeof runExternalDiscovery>> | null = null;

  try {
    internal = await runInternalDiscoverySweep({ tenantId, actorUserId });
  } catch (err) {
    console.error('[pr:discover-sweep:internal]', (err as Error).message);
  }
  try {
    external = await runExternalDiscovery({ tenantId, actorUserId });
  } catch (err) {
    console.error('[pr:discover-sweep:external]', (err as Error).message);
  }

  const elapsedMs = Date.now() - start;
  await logEvent({
    eventType: PR_EVENTS.discoverySwept,
    userId: actorUserId,
    source: triggerSource === 'cron' ? 'cron' : 'manual',
    status: internal || external ? 'success' : 'failure',
    payload: {
      trigger_source: triggerSource,
      tenant_id: tenantId,
      external_lanes: external?.lanes?.length ?? 0
    },
    executionTimeMs: elapsedMs
  });

  return NextResponse.json({
    ok: true,
    triggerSource,
    elapsedMs,
    internal,
    external
  });
}
