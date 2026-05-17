/**
 * POST /api/client/login
 *
 * Public endpoint.
 *   Body: { email, password }
 *   Sets the ah_client_session cookie on success.
 *
 *   - Validates with Zod.
 *   - Rate-limits per IP (5/15min) — same envelope as the operator login.
 *   - Constant-time-ish bcrypt regardless of user existence (no timing leak).
 *   - Returns generic error messages (no user-existence leak).
 *
 * Search marker: [client-portal:login].
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { findClientUserByEmail, markClientUserLoggedIn } from '@/lib/auth/client-user';
import { signClientSessionJwt } from '@/lib/auth/client-jwt';
import { setClientSessionCookie } from '@/lib/auth/client-session';
import { verifyPassword } from '@/lib/auth/password';
import { checkAndConsume, LOGIN_RATE_LIMIT } from '@/lib/rate-limit';
import { ipHash } from '@/lib/crypto/hash';
import { writeAuditRow, extractClientIp } from '@/lib/audit';

export const runtime = 'nodejs';

const LoginSchema = z.object({
  email: z.string().email().max(255).transform((s) => s.toLowerCase().trim()),
  password: z.string().min(1).max(200)
});

const INVALID_BCRYPT = '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid';

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req.headers);
  const ua = req.headers.get('user-agent');

  // Rate limit per IP.
  const rl = await checkAndConsume({
    bucketKey: `client-login:ip:${ipHash(ip)}`,
    limit: LOGIN_RATE_LIMIT.limit,
    windowSeconds: LOGIN_RATE_LIMIT.windowSeconds
  });
  if (!rl.allowed) {
    await writeAuditRow({
      targetResource: '/api/client/login',
      action: 'client_login_rate_limited',
      ip,
      userAgent: ua,
      statusCode: 429,
      errorClass: 'RateLimited'
    });
    return NextResponse.json({ error: 'too many attempts' }, { status: 429 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = LoginSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid credentials' }, { status: 400 });
  }
  const { email, password } = parsed.data;

  try {
    const user = await findClientUserByEmail(email);

    // Always run bcrypt to avoid timing leak.
    const hash = user?.password_hash ?? INVALID_BCRYPT;
    const ok = await verifyPassword(password, hash);

    if (!user || !user.password_hash || !ok) {
      await writeAuditRow({
        actorUserId: user?.client_user_id ?? null,
        targetResource: '/api/client/login',
        action: 'client_login_failed',
        ip,
        userAgent: ua,
        statusCode: 401,
        errorClass: 'AuthFailed'
      });
      return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
    }

    const sessionId = randomUUID();
    const jwt = await signClientSessionJwt({
      clientUserId: user.client_user_id,
      sessionId
    });
    setClientSessionCookie(jwt);
    await markClientUserLoggedIn(user.client_user_id);

    // eslint-disable-next-line no-console
    console.log('[client-portal:login]', JSON.stringify({
      client_user_id: user.client_user_id,
      email: user.email
    }));

    await writeAuditRow({
      actorUserId: user.client_user_id,
      actorRole: 'client_user',
      targetResource: '/api/client/login',
      action: 'client_login_success',
      ip,
      userAgent: ua,
      statusCode: 200
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[client-portal:login] error:', (err as Error).message);
    await writeAuditRow({
      targetResource: '/api/client/login',
      action: 'client_login_error',
      ip,
      userAgent: ua,
      statusCode: 500,
      errorClass: (err as Error).name || 'UnknownError'
    });
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
