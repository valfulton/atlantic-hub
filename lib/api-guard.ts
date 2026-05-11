/**
 * Common request-handling wrapper for /api/admin/* routes.
 *
 * Applies:
 *   1. Actor extraction (middleware already authed; we just read headers)
 *   2. API rate limit (60 req/min per session)
 *   3. Audit log write (one row per call)
 *
 * Returns either a NextResponse to short-circuit (rate-limited) or
 * an `actor` object the handler can use.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readActorFromHeaders } from '@/lib/auth/session';
import { checkAndConsume, API_RATE_LIMIT } from '@/lib/rate-limit';
import { writeAuditRow, extractClientIp } from '@/lib/audit';

export interface GuardResult {
  ok: true;
  actor: { userId: number; role: 'owner' | 'staff' | 'client_user'; sessionId: string };
  ip: string;
  ua: string | null;
}

export interface GuardFail {
  ok: false;
  response: NextResponse;
}

export async function guardAdminRequest(
  req: NextRequest,
  params: { targetResource: string; tenantId?: string }
): Promise<GuardResult | GuardFail> {
  const actor = readActorFromHeaders(req.headers);
  const ip = extractClientIp(req.headers);
  const ua = req.headers.get('user-agent');

  if (!actor) {
    // Should not happen — middleware should have caught it — but defense in depth.
    await writeAuditRow({
      targetResource: params.targetResource,
      action: 'denied_no_actor',
      tenantId: params.tenantId,
      ip,
      userAgent: ua,
      statusCode: 401,
      errorClass: 'NoActor'
    });
    return { ok: false, response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }

  const rl = await checkAndConsume({
    bucketKey: `api:session:${actor.sessionId}`,
    limit: API_RATE_LIMIT.limit,
    windowSeconds: API_RATE_LIMIT.windowSeconds
  });
  if (!rl.allowed) {
    await writeAuditRow({
      actorUserId: actor.userId,
      actorRole: actor.role,
      targetResource: params.targetResource,
      tenantId: params.tenantId,
      action: 'rate_limited',
      ip,
      userAgent: ua,
      statusCode: 429,
      errorClass: 'RateLimited'
    });
    return { ok: false, response: NextResponse.json({ error: 'rate limited' }, { status: 429 }) };
  }

  // Success: log the view and let the handler run.
  await writeAuditRow({
    actorUserId: actor.userId,
    actorRole: actor.role,
    targetResource: params.targetResource,
    tenantId: params.tenantId,
    action: 'view',
    ip,
    userAgent: ua,
    statusCode: 200
  });

  return { ok: true, actor, ip, ua };
}
