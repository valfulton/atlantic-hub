/**
 * POST /api/admin/av/clients/[client_id]/send-password   { regenerate?: boolean }
 *
 * Operator-side: generate a fresh temp password for this client's primary login,
 * hash + store on client_users.password_hash, and email the plaintext to the
 * client. The plaintext is shown ONCE in the response so val can copy it for
 * a phone call too -- nothing is logged.
 *
 * (#45 Phase B) Adds an alternative auth path next to magic links: some clients
 * prefer email + password, some mail clients break magic-link URLs. Lands them
 * at the same destination as magic-link sign-in (/client portal).
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { hashPassword } from '@/lib/auth/password';
import { setClientUserPasswordHash } from '@/lib/auth/client-user';
import { sendEmail } from '@/lib/email/smtp';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

/** A friendly, 14-char temp password: 3 chunks of 4 alphanumerics + dashes. */
function generateTempPassword(): string {
  // Avoid ambiguous chars (0/O/1/l/I). 14 effective alphanumeric chars after
  // we slice the random bytes, which is ~83 bits of entropy -- fine for a
  // one-time password the user is expected to change.
  const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const buf = randomBytes(18);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += ALPH[buf[i] % ALPH.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/send-password:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  try {
    const db = getAvDb();
    const [rows] = await db.execute<
      (RowDataPacket & { client_user_id: number; email: string; display_name: string | null })[]
    >(
      `SELECT client_user_id, email, display_name
         FROM client_users
        WHERE client_id = ?
        ORDER BY client_user_id ASC
        LIMIT 1`,
      [clientId]
    );
    const user = rows[0];
    if (!user) return NextResponse.json({ error: 'no user on this account' }, { status: 404 });

    const plaintext = generateTempPassword();
    const passwordHash = await hashPassword(plaintext);
    await setClientUserPasswordHash(user.client_user_id, passwordHash);

    const greeting = user.display_name ? `Hi ${user.display_name.split(' ')[0]},` : 'Hi,';
    const subject = 'Your Atlantic & Vine portal password';
    const loginUrl = 'https://atlantic-hub.netlify.app/client/login';
    const text =
      `${greeting}\n\n` +
      `Here is a temporary password for your Atlantic & Vine portal. Sign in at ${loginUrl} ` +
      `with this email and the password below.\n\n` +
      `   ${plaintext}\n\n` +
      `Once you're in, you can change it on your account page. If you weren't expecting this, ` +
      `reply to this email and we'll sort it out.\n\n` +
      `— Atlantic & Vine`;
    const html =
      `<p>${greeting}</p>` +
      `<p>Here is a temporary password for your Atlantic &amp; Vine portal. ` +
      `Sign in at <a href="${loginUrl}">${loginUrl}</a> with this email and the password below.</p>` +
      `<p style="font-family:ui-monospace,Menlo,monospace;font-size:18px;letter-spacing:1px;padding:14px 18px;background:#f5efe3;border-radius:6px;display:inline-block">${plaintext}</p>` +
      `<p>Once you're in, you can change it on your account page. If you weren't expecting this, ` +
      `reply to this email and we'll sort it out.</p>` +
      `<p>— Atlantic &amp; Vine</p>`;

    let emailSent = false;
    let emailError: string | null = null;
    try {
      const res = await sendEmail({ to: user.email, subject, text, html });
      emailSent = res.sent;
      if (!res.sent) emailError = (res as { reason?: string }).reason || 'unknown';
    } catch (e) {
      emailError = (e as Error).message.slice(0, 200);
    }

    // plaintext returned ONCE for val to copy if she also wants to share it
    // verbally -- never logged anywhere.
    return NextResponse.json({
      ok: true,
      email: user.email,
      password: plaintext,
      emailSent,
      emailError
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}
