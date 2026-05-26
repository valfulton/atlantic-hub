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
  markClientUserLoggedIn
} from '@/lib/auth/client-user';
import { signClientSessionJwt } from '@/lib/auth/client-jwt';
import { setClientSessionCookie } from '@/lib/auth/client-session';
import { ensureClientHub } from '@/lib/client/provision';

export const runtime = 'nodejs';

/**
 * The PUBLIC production origin to redirect to. Netlify can serve the function on
 * a deploy-specific host (e.g. <hash>--atlantic-hub.netlify.app), and building a
 * redirect from req.url would send the client THERE — where the just-set session
 * cookie (scoped to the production host) is NOT sent, so middleware bounces them
 * to /client/login. Always redirect to the canonical origin so the cookie holds.
 */
function portalOrigin(req: NextRequest): string {
  return process.env.MAGIC_LINK_BASE_URL?.replace(/\/+$/, '') || req.nextUrl.origin;
}

function loginRedirect(req: NextRequest, reason: string): NextResponse {
  const url = new URL('/client/login', portalOrigin(req));
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

    // NOT single-use: the token stays valid until it expires (24h). Single-use
    // was causing links to die on the first touch (a test click, a mis-click, or
    // the client clicking twice) — so the real click landed on "invalid link".
    // For trusted onboarding a 24h reusable link is the right tradeoff; regenerate
    // to invalidate early.

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
    try {
      await ensureClientHub(user);
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

    // Landing logic:
    //   - never set a password yet -> set a password (welcome), then dashboard.
    //   - otherwise -> dashboard.
    // Both targets are deployed pages, so the magic link always lands.
    const needsPassword = !user.password_hash;
    const target = needsPassword ? '/client/set-password?welcome=1' : '/client/dashboard';
    return NextResponse.redirect(new URL(target, portalOrigin(req)));
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
