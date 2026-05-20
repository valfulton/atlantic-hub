/**
 * POST /api/admin/av/nurture-wake
 *
 * Wake leads whose wake_at_date <= today. Same dual-auth pattern as
 * pain-sweep / score-sweep: admin cookie OR X-Cron-Secret header.
 *
 * Body: ignored. The sweep operates on whatever is due.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { runDateBasedWakeSweep } from '@/lib/leads/lifecycle';
import { logEvent } from '@/lib/events/log';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const cronSecret = process.env.ENRICHMENT_CRON_SECRET;
  const incomingCronSecret = req.headers.get('x-cron-secret');
  const cronAuthorized = !!cronSecret && !!incomingCronSecret && cronSecret === incomingCronSecret;

  let actorUserId: number | null = null;
  if (!cronAuthorized) {
    const guard = await guardAdminRequest(req, {
      targetResource: '/api/admin/av/nurture-wake',
      tenantId: 'av'
    });
    if (!guard.ok) return guard.response;
    if (guard.actor.role === 'client_user') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    actorUserId = guard.actor.userId;
  }

  const triggerSource = cronAuthorized ? 'cron' : 'manual';
  const start = Date.now();

  try {
    const result = await runDateBasedWakeSweep();
    await logEvent({
      eventType: 'lifecycle.wake_sweep_run',
      userId: actorUserId,
      source: 'cron',
      status: 'success',
      payload: { trigger_source: triggerSource, woken: result.woken, lead_ids: result.leadIds.slice(0, 50) },
      executionTimeMs: Date.now() - start
    });
    return NextResponse.json({ ok: true, triggerSource, ...result });
  } catch (err) {
    await logEvent({
      eventType: 'lifecycle.wake_sweep_error',
      userId: actorUserId,
      source: 'cron',
      status: 'failure',
      errorMessage: (err as Error).message.slice(0, 500)
    });
    return NextResponse.json({ error: 'wake_sweep_failed', message: (err as Error).message.slice(0, 300) }, { status: 500 });
  }
}
