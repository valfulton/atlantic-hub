/**
 * POST /api/client/set-password
 *
 * Authenticated client-user only. Sets (or replaces) the password_hash
 * for the logged-in client_user. Used for first-time setup after the
 * magic-link redirect, and for self-service password changes later.
 *
 * Body: { password: string (min 10) }
 *
 * Search marker: [client-portal:set-password].
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { findClientUserById, setClientUserPasswordHash } from '@/lib/auth/client-user';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { hashPassword } from '@/lib/auth/password';
import { writeAuditRow, extractClientIp } from '@/lib/audit';

export const runtime = 'nodejs';

const SetPasswordSchema = z.object({
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(200, 'Password too long')
});

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req.headers);
  const ua = req.headers.get('user-agent');

  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = SetPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.errors[0]?.message ?? 'invalid input';
    return NextResponse.json({ error: first }, { status: 400 });
  }

  try {
    const user = await findClientUserById(actor.clientUserId);
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const hash = await hashPassword(parsed.data.password);
    await setClientUserPasswordHash(user.client_user_id, hash);

    // eslint-disable-next-line no-console
    console.log('[client-portal:set-password]', JSON.stringify({
      client_user_id: user.client_user_id,
      email: user.email,
      first_time: user.password_hash == null
    }));

    await writeAuditRow({
      actorUserId: user.client_user_id,
      actorRole: 'client_user',
      targetResource: '/api/client/set-password',
      action: user.password_hash ? 'password_changed' : 'password_set',
      ip,
      userAgent: ua,
      statusCode: 200
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[client-portal:set-password] error:', (err as Error).message);
    await writeAuditRow({
      actorUserId: actor.clientUserId,
      actorRole: 'client_user',
      targetResource: '/api/client/set-password',
      action: 'set_password_error',
      ip,
      userAgent: ua,
      statusCode: 500,
      errorClass: (err as Error).name || 'UnknownError'
    });
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
