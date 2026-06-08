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
    // (#368) Resolve the login that should receive the magic link in this order:
    //   1. A client_user directly keyed to this client_id (single-brand case)
    //   2. The OWNER member of this brand via brand_members (multi-brand case,
    //      e.g. Adriana — CLDA has no direct client_user, the owner row points
    //      at CBB and shows up here only through brand_members)
    //   3. Any member of this brand as a last resort.
    // The 'attachedVia' field on the response tells the UI which path resolved
    // so we can show "this magic link belongs to Adriana@..., owner across both
    // brands" rather than just dropping a URL.
    let user: { client_user_id: number; email: string; display_name: string | null; password_hash: string | null } | undefined;
    let attachedVia: 'direct' | 'brand_member_owner' | 'brand_member' | null = null;
    const [directRows] = await db.execute<(RowDataPacket & { client_user_id: number; email: string; display_name: string | null; password_hash: string | null })[]>(
      `SELECT client_user_id, email, display_name, password_hash
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
      const [memberRows] = await db.execute<(RowDataPacket & { client_user_id: number; email: string; display_name: string | null; password_hash: string | null; role: string })[]>(
        `SELECT cu.client_user_id, cu.email, cu.display_name, cu.password_hash, bm.role
           FROM brand_members bm
           JOIN client_users cu ON cu.client_user_id = bm.client_user_id
          WHERE bm.client_id = ? AND cu.archived_at IS NULL
          ORDER BY FIELD(bm.role,'owner','rep','viewer'), bm.created_at ASC
          LIMIT 1`,
        [clientId]
      );
      if (memberRows[0]) {
        user = { ...memberRows[0] };
        attachedVia = memberRows[0].role === 'owner' ? 'brand_member_owner' : 'brand_member';
      }
    }
    if (!user) {
      return NextResponse.json(
        {
          error: 'no_user',
          reason: 'No login is attached to this brand yet. Use the "Email + password" panel below to create one — that provisions a client_user, then this link will work.'
        },
        { status: 404 }
      );
    }

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

    // (#511) Mark "intake link sent" so the onboarding badge reflects reality.
    // Setting on any regenerate (send=true OR copy-to-clipboard) — both mean
    // val intends to share, otherwise she wouldn't have hit this endpoint.
    // Non-fatal if the column doesn't exist (schema 078 pending).
    try {
      await db.execute(
        `UPDATE client_users SET intake_link_sent_at = NOW() WHERE client_user_id = ?`,
        [user.client_user_id]
      );
    } catch { /* non-fatal */ }

    return NextResponse.json({
      ok: true,
      link,
      email: user.email,
      displayName: user.display_name,
      expiresInHours: MAGIC_TOKEN_TTL_HOURS,
      emailSent,
      // (#368) UI uses this to disambiguate when the login is a shared owner
      // across multiple brands ("Sent to the owner of CBB + CLDA").
      attachedVia
    });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
