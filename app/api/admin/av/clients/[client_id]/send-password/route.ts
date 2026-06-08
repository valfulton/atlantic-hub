/**
 * POST /api/admin/av/clients/[client_id]/send-password
 *
 * Body: { password?: string, send?: boolean }
 *   - password: omit -> auto-generate. Pass a string -> use exactly that
 *               (val's "ultimate control" override).
 *   - send: default true. Pass false to save the password hash without
 *           emailing -- val shares it manually (call, text, whatever).
 *
 * Operator-side: set this client's primary login password (random or manual),
 * hash + store on client_users.password_hash, optionally email plaintext.
 * The plaintext is ALWAYS returned in the response (once) so val can copy
 * it. Nothing is logged.
 *
 * (#45 Phase B) Adds an alternative auth path next to magic links: some clients
 * prefer email + password, some mail clients break magic-link URLs. Lands them
 * at the same destination as magic-link sign-in (/client portal).
 *
 * Owner + staff only. 404 returns the body {error: 'no_user', reason: '...'}
 * so the client can render a friendly message instead of HTTP status only.
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

  let body: { password?: unknown; send?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // empty body is fine -- defaults apply
  }

  // Manual password override: val types her own; otherwise auto-generate.
  // Min 6 chars (clients have to type it in; below 6 is hostile UX).
  const manual = typeof body.password === 'string' ? body.password.trim() : '';
  const useManual = manual.length > 0;
  if (useManual && manual.length < 6) {
    return NextResponse.json({ error: 'password too short', minLength: 6 }, { status: 400 });
  }
  // Default to sending; set false if val wants to share the password herself.
  const shouldSend = body.send !== false;

  try {
    const db = getAvDb();
    // (#368) Same resolution order as magic-link: direct client_user first,
    // then brand_members owner, then any brand_member. Lets val set a password
    // on a multi-brand owner who only shows up here via brand_members.
    let user: { client_user_id: number; email: string; display_name: string | null } | undefined;
    let attachedVia: 'direct' | 'brand_member_owner' | 'brand_member' | null = null;
    const [directRows] = await db.execute<
      (RowDataPacket & { client_user_id: number; email: string; display_name: string | null })[]
    >(
      `SELECT client_user_id, email, display_name
         FROM client_users
        WHERE client_id = ?
        ORDER BY client_user_id ASC
        LIMIT 1`,
      [clientId]
    );
    if (directRows[0]) {
      user = directRows[0];
      attachedVia = 'direct';
    } else {
      const [memberRows] = await db.execute<
        (RowDataPacket & { client_user_id: number; email: string; display_name: string | null; role: string })[]
      >(
        `SELECT cu.client_user_id, cu.email, cu.display_name, bm.role
           FROM brand_members bm
           JOIN client_users cu ON cu.client_user_id = bm.client_user_id
          WHERE bm.client_id = ? AND cu.archived_at IS NULL
          ORDER BY FIELD(bm.role,'owner','rep','viewer'), bm.created_at ASC
          LIMIT 1`,
        [clientId]
      );
      if (memberRows[0]) {
        user = {
          client_user_id: memberRows[0].client_user_id,
          email: memberRows[0].email,
          display_name: memberRows[0].display_name
        };
        attachedVia = memberRows[0].role === 'owner' ? 'brand_member_owner' : 'brand_member';
      }
    }
    if (!user) {
      return NextResponse.json(
        {
          error: 'no_user',
          reason: 'No login on this brand yet. Use the "Attach login" panel to create one (we\'ll provision the client_user + this password in one step).'
        },
        { status: 404 }
      );
    }

    const plaintext = useManual ? manual : generateTempPassword();
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
    if (shouldSend) {
      try {
        const res = await sendEmail({ to: user.email, subject, text, html });
        emailSent = res.sent;
        if (!res.sent) emailError = (res as { reason?: string }).reason || 'unknown';
      } catch (e) {
        emailError = (e as Error).message.slice(0, 200);
      }
    }

    // (#511) Mark "intake link sent" so the onboarding badge reflects reality.
    // We set this on any explicit send attempt (even shouldSend=false counts
    // as "val knows the password and is about to share it manually"). Wrapped
    // in try so missing column (schema 078 not yet applied) doesn't 500.
    try {
      await db.execute(
        `UPDATE client_users SET intake_link_sent_at = NOW() WHERE client_user_id = ?`,
        [user.client_user_id]
      );
    } catch { /* column may not exist yet; non-fatal */ }

    // plaintext returned ONCE for val to copy. Never logged anywhere.
    return NextResponse.json({
      ok: true,
      email: user.email,
      password: plaintext,
      emailSent,
      emailError,
      sentSkipped: !shouldSend,
      manual: useManual,
      attachedVia
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}
