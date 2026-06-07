/**
 * POST /api/client/magic-link/resend   { email }
 *
 * PUBLIC, self-serve. An existing client whose original magic link expired
 * (or who never set a password before their session lapsed) can request a
 * fresh secure link from the /client/login page WITHOUT resubmitting the
 * public intake form.
 *
 * Security envelope (mirrors /api/client/login):
 *   - Rate-limited per IP (5 / 15 min) so it can't be used to spam inboxes.
 *   - ALWAYS returns a generic { ok: true } regardless of whether the email
 *     matched a real account — no user-existence leak.
 *   - Only ever emails the address ON the matched account (never an address
 *     supplied by the caller that isn't the account's own), so it can't be
 *     turned into an open relay.
 *   - Regenerates the token on the existing login (same UPDATE the operator
 *     "Resend magic link" button uses); the 24h reusable link then lands them
 *     on set-password (if no password yet) or the dashboard.
 *
 * NOT in the middleware matcher on purpose — like /api/client/login it must be
 * reachable without a session.
 *
 * Search marker: [client-portal:magic-link-resend].
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { findClientUserByEmail } from '@/lib/auth/client-user';
import { getAvDb } from '@/lib/db/av';
import {
  generateMagicToken,
  magicTokenExpiresAt,
  buildMagicLinkUrl,
  MAGIC_TOKEN_TTL_HOURS
} from '@/lib/auth/client-magic-token';
import { sendEmail } from '@/lib/email/smtp';
import { buildMagicLinkEmail } from '@/lib/email/magic-link-template';
import { checkAndConsume, LOGIN_RATE_LIMIT } from '@/lib/rate-limit';
import { ipHash } from '@/lib/crypto/hash';
import { writeAuditRow, extractClientIp } from '@/lib/audit';
import type { ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

const ResendSchema = z.object({
  email: z.string().email().max(255).transform((s) => s.toLowerCase().trim())
});

// Generic success body — identical whether or not the email matched, so the
// response can't be used to probe which addresses have accounts.
const GENERIC_OK = {
  ok: true,
  message: 'If that email has an account, a secure sign-in link is on its way.'
};

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req.headers);
  const ua = req.headers.get('user-agent');

  // Rate limit per IP (same envelope as client login).
  const rl = await checkAndConsume({
    bucketKey: `client-resend:ip:${ipHash(ip)}`,
    limit: LOGIN_RATE_LIMIT.limit,
    windowSeconds: LOGIN_RATE_LIMIT.windowSeconds
  });
  if (!rl.allowed) {
    await writeAuditRow({
      targetResource: '/api/client/magic-link/resend',
      action: 'magic_link_resend_rate_limited',
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
  const parsed = ResendSchema.safeParse(raw);
  if (!parsed.success) {
    // A malformed email is a client error, but still don't leak anything useful.
    return NextResponse.json({ error: 'enter a valid email' }, { status: 400 });
  }
  const { email } = parsed.data;

  try {
    const user = await findClientUserByEmail(email);

    // No match -> do nothing, but return the SAME generic body + 200.
    if (!user) {
      await writeAuditRow({
        targetResource: '/api/client/magic-link/resend',
        action: 'magic_link_resend_no_match',
        ip,
        userAgent: ua,
        statusCode: 200
      });
      return NextResponse.json(GENERIC_OK);
    }

    // Regenerate the token on the existing login (same write the operator
    // "Resend magic link" button performs).
    const token = generateMagicToken();
    const expiresAt = magicTokenExpiresAt();
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `UPDATE client_users SET magic_token = ?, magic_token_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE client_user_id = ?`,
      [token, expiresAt, user.client_user_id]
    );

    // Email ONLY the account's own address — never an attacker-supplied one.
    const link = buildMagicLinkUrl(token);
    let emailSent = false;
    try {
      const mail = buildMagicLinkEmail({
        recipientName: user.display_name,
        magicLinkUrl: link,
        expiresInHours: MAGIC_TOKEN_TTL_HOURS,
        isFirstTime: !user.password_hash
      });
      const res = await sendEmail({ to: user.email, subject: mail.subject, text: mail.text, html: mail.html });
      emailSent = res.sent;
    } catch {
      emailSent = false;
    }

    await writeAuditRow({
      actorUserId: user.client_user_id,
      actorRole: 'client_user',
      targetResource: '/api/client/magic-link/resend',
      action: emailSent ? 'magic_link_resend_sent' : 'magic_link_resend_send_failed',
      ip,
      userAgent: ua,
      statusCode: 200
    });

    return NextResponse.json(GENERIC_OK);
  } catch (err) {
    await writeAuditRow({
      targetResource: '/api/client/magic-link/resend',
      action: 'magic_link_resend_error',
      ip,
      userAgent: ua,
      statusCode: 500,
      errorClass: (err as Error).name || 'UnknownError'
    });
    // Still generic to the caller.
    return NextResponse.json(GENERIC_OK);
  }
}
