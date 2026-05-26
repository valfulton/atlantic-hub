/**
 * POST /api/admin/av/clients/[client_id]/magic-link   { send?: boolean }
 *
 * Generate a FRESH magic-link for an existing client (their original link from
 * account creation expires in 24h). Issues a new token on the client's primary
 * user, returns the URL to copy, and optionally emails it. Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import {
  generateMagicToken,
  magicTokenExpiresAt,
  buildMagicLinkUrl,
  MAGIC_TOKEN_TTL_HOURS
} from '@/lib/auth/client-magic-token';
import { sendEmail } from '@/lib/email/smtp';
import { buildMagicLinkEmail } from '@/lib/email/magic-link-template';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/clients/magic-link:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) return NextResponse.json({ error: 'invalid client id' }, { status: 400 });

  let body: { send?: unknown } = {};
  try { body = await req.json(); } catch { /* default: no email */ }
  const send = body.send === true;

  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { client_user_id: number; email: string; display_name: string | null; password_hash: string | null })[]>(
      `SELECT client_user_id, email, display_name, password_hash
         FROM client_users
        WHERE client_id = ?
        ORDER BY client_user_id ASC
        LIMIT 1`,
      [clientId]
    );
    const user = rows[0];
    if (!user) return NextResponse.json({ error: 'no user on this account' }, { status: 404 });

    const token = generateMagicToken();
    const expiresAt = magicTokenExpiresAt();
    await db.execute<ResultSetHeader>(
      `UPDATE client_users SET magic_token = ?, magic_token_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE client_user_id = ?`,
      [token, expiresAt, user.client_user_id]
    );

    // Plain link, no query param. The intake GATE lands them on /client/intake
    // automatically (and keeps the hub locked) until they submit the form, so
    // there's nothing to append — and no %2F for the CDN edge to 404.
    const link = buildMagicLinkUrl(token);
    let emailSent = false;
    if (send) {
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
    }

    return NextResponse.json({ ok: true, link, email: user.email, expiresInHours: MAGIC_TOKEN_TTL_HOURS, emailSent });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
