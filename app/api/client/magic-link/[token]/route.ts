/**
 * GET /api/client/magic-link/[token]
 *
 * Public endpoint. Validates the magic token, consumes it (single-use),
 * sets the ah_client_session cookie, then redirects:
 *   - to /client/set-password if the user has never set a password
 *   - to /client/dashboard otherwise
 *
 * Invalid / expired tokens redirect to /client/login?error=invalid_link
 * so the user gets a clear message without leaking which tokens existed.
 *
 * TODO(system_events): emit 'client_portal.magic_link_consumed' once the
 * unified event stream lands.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { extractClientIp, writeAuditRow } from '@/lib/audit';
import {
  findClientUserByMagicToken,
  consumeMagicToken,
  markClientUserLoggedIn
} from '@/lib/auth/client-user';
import { signClientSessionJwt } from '@/lib/auth/client-jwt';
import { setClientSessionCookie } from '@/lib/auth/client-session';
import { ensureClientHub } from '@/lib/client/provision';
import { clientMayAccessHub } from '@/lib/client/intake_gate';

export const runtime = 'nodejs';

function loginRedirect(req: NextRequest, reason: string): NextResponse {
  const url = new URL('/client/login', req.url);
  url.searchParams.set('error', reason);
  return NextResponse.redirect(url);
}

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const ip = extractClientIp(req.headers);
  const ua = req.headers.get('user-agent');
  const token = params.token;

  if (!token || token.length !== 64 || !/^[a-f0-9]{64}$/i.test(token)) {
    await writeAuditRow({
      targetResource: '/api/client/magic-link',
      action: 'magic_link_bad_format',
      ip,
      userAgent: ua,
      statusCode: 400,
      errorClass: 'BadInput'
    });
    return loginRedirect(req, 'invalid_link');
  }

  try {
    const user = await findClientUserByMagicToken(token);
    if (!user) {
      await writeAuditRow({
        targetResource: '/api/client/magic-link',
        action: 'magic_link_invalid_or_expired',
        ip,
        userAgent: ua,
        statusCode: 401,
        errorClass: 'InvalidToken'
      });
      return loginRedirect(req, 'invalid_link');
    }

    // Single-use: clear the token immediately.
    await consumeMagicToken(user.client_user_id);

    // Sign + set session cookie.
    const sessionId = randomUUID();
    const jwt = await signClientSessionJwt({
      clientUserId: user.client_user_id,
      sessionId
    });
    setClientSessionCookie(jwt);
    await markClientUserLoggedIn(user.client_user_id);

    // Provision this account's own hub (idempotent, non-fatal): they build
    // from scratch, so they need a clients row to own their leads/content.
    let clientId: number | null = user.client_id ?? null;
    try {
      const cid = await ensureClientHub(user);
      if (cid) clientId = cid;
    } catch (e) {
      console.error('[client-portal:magic-link] provision skipped:', (e as Error).message);
    }

    await writeAuditRow({
      actorUserId: user.client_user_id,
      actorRole: 'client_user',
      targetResource: '/api/client/magic-link',
      action: 'magic_link_consumed',
      ip,
      userAgent: ua,
      statusCode: 200
    });

    // Landing logic — zero friction to the intake:
    //   1. Intake not done (and no operator override) -> straight to their
    //      pre-filled intake. NO password/sign-in step to fail; the magic link
    //      itself is the auth. The portal stays locked (gate) until they submit.
    //   2. Allowed in but no password yet -> set a password.
    //   3. Allowed in with a password -> dashboard.
    const needsPassword = !user.password_hash;
    let target: string;
    if (!(await clientMayAccessHub(clientId))) {
      target = '/client/intake';
    } else if (needsPassword) {
      target = '/client/set-password?welcome=1';
    } else {
      target = '/client/dashboard';
    }
    return NextResponse.redirect(new URL(target, req.url));
  } catch (err) {
    await writeAuditRow({
      targetResource: '/api/client/magic-link',
      action: 'magic_link_error',
      ip,
      userAgent: ua,
      statusCode: 500,
      errorClass: (err as Error).name || 'UnknownError'
    });
    console.error('[client-portal:magic-link-error]', (err as Error).message);
    return loginRedirect(req, 'something_went_wrong');
  }
}
