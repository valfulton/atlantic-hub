/**
 * POST /api/auth/login
 *
 * Body: { email: string, password: string }
 *
 * - Validates with Zod (rejects SQL/garbage payloads before any DB hit)
 * - Rate limit: 5 attempts per IP per 15 minutes
 * - Bcrypt compare against admin_users.password_hash
 * - Respects admin_login_enabled feature flag
 * - On success: sets ah_session cookie (HttpOnly + Secure + SameSite=Strict)
 * - On failure: returns 401 with generic message (no user-existence leak)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getPlatformDb } from '@/lib/db/platform';
import { verifyPassword } from '@/lib/auth/password';
import { signSessionJwt } from '@/lib/auth/jwt';
import { setSessionCookie } from '@/lib/auth/session';
import { ensureOwnerBootstrap, type AdminUserRow } from '@/lib/auth/bootstrap';
import { writeAuditRow, extractClientIp } from '@/lib/audit';
import { checkAndConsume, LOGIN_RATE_LIMIT } from '@/lib/rate-limit';
import { isFlagEnabled, mysqlBoolToJs } from '@/lib/feature-flags';
import { ipHash } from '@/lib/crypto/hash';

export const runtime = 'nodejs';

const LoginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200)
});

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req.headers);
  const ua = req.headers.get('user-agent');

  // Global kill switch.
  const loginEnabled = await isFlagEnabled('admin_login_enabled');
  if (!loginEnabled) {
    await writeAuditRow({
      targetResource: '/api/auth/login',
      action: 'login_disabled',
      ip,
      userAgent: ua,
      statusCode: 503,
      errorClass: 'AdminLoginDisabled'
    });
    return NextResponse.json({ error: 'login disabled' }, { status: 503 });
  }

  // Rate limit per IP.
  const rl = await checkAndConsume({
    bucketKey: `login:ip:${ipHash(ip)}`,
    limit: LOGIN_RATE_LIMIT.limit,
    windowSeconds: LOGIN_RATE_LIMIT.windowSeconds
  });
  if (!rl.allowed) {
    await writeAuditRow({
      targetResource: '/api/auth/login',
      action: 'login_rate_limited',
      ip,
      userAgent: ua,
      statusCode: 429,
      errorClass: 'RateLimited'
    });
    return NextResponse.json({ error: 'too many attempts' }, { status: 429 });
  }

  // Validate body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    await writeAuditRow({
      targetResource: '/api/auth/login',
      action: 'login_bad_input',
      ip,
      userAgent: ua,
      statusCode: 400,
      errorClass: 'BadInput'
    });
    return NextResponse.json({ error: 'invalid credentials' }, { status: 400 });
  }
  const { email, password } = parsed.data;

  try {
    await ensureOwnerBootstrap();
    const db = getPlatformDb();
    const [rows] = await db.execute<AdminUserRow[]>(
      `SELECT user_id, email, password_hash, role, is_active, display_name
       FROM admin_users WHERE email = ? LIMIT 1`,
      [email]
    );

    const user = rows[0];
    // Always run bcrypt even if user missing, to avoid timing leak.
    const hashToCheck = user?.password_hash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid';
    const ok = await verifyPassword(password, hashToCheck);

    // Use mysqlBoolToJs to handle Buffer/number/string representations
    // of the is_active boolean — protects against logging in a disabled user.
    const isActive = user ? mysqlBoolToJs(user.is_active) : false;

    if (!user || !ok || !isActive) {
      await writeAuditRow({
        actorUserId: user?.user_id ?? null,
        targetResource: '/api/auth/login',
        action: 'login_failed',
        ip,
        userAgent: ua,
        statusCode: 401,
        errorClass: 'AuthFailed'
      });
      return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
    }

    const sessionId = randomUUID();
    const token = await signSessionJwt({
      userId: user.user_id,
      role: user.role,
      sessionId
    });
    await setSessionCookie(token);

    await db.execute(
      'UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [user.user_id]
    );

    await writeAuditRow({
      actorUserId: user.user_id,
      actorRole: user.role,
      targetResource: '/api/auth/login',
      action: 'login_success',
      ip,
      userAgent: ua,
      statusCode: 200
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    await writeAuditRow({
      targetResource: '/api/auth/login',
      action: 'error',
      ip,
      userAgent: ua,
      statusCode: 500,
      errorClass: (err as Error).name || 'UnknownError'
    });
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
