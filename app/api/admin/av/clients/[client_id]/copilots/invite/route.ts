/**
 * POST /api/admin/av/clients/[client_id]/copilots/invite   (Spinoff B)
 *
 * "Invite co-pilot" — mint a SECOND login on this brand so two people (e.g.
 * Kevin Lyons + Maile Lyons on The Flame, client_id 16) can each sign in with
 * their own email and see the SAME brand. Returns a shareable magic link for
 * the new co-pilot; optionally emails it directly.
 *
 * Body: { email: string, displayName?: string, send?: boolean }
 *
 * Owner + staff only. The data model needs no migration — a co-pilot is just
 * another client_users row bound to the same client_id (see lib/av/account_team.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { inviteCopilot } from '@/lib/av/account_team';
import { sendEmail } from '@/lib/email/smtp';
import { buildMagicLinkEmail } from '@/lib/email/magic-link-template';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/copilots/invite:POST',
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

  let body: { email?: unknown; displayName?: unknown; send?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName : null;
  const send = body.send === true;

  const result = await inviteCopilot(clientId, email, displayName);
  if (!result.ok) {
    // email-on-other-brand is a 409; bad input 400; everything else 500.
    const status =
      result.error === 'email_on_other_brand' ? 409
      : result.error === 'bad_email' || result.error === 'bad_client_id' || result.error === 'no_client' ? 400
      : 500;
    return NextResponse.json(result, { status });
  }

  // Optionally email the co-pilot their sign-in link. Non-fatal: if SMTP fails
  // the operator still has the link in the response to copy + send manually.
  let emailSent = false;
  if (send && result.magicLink) {
    try {
      const mail = buildMagicLinkEmail({
        recipientName: result.displayName ?? null,
        magicLinkUrl: result.magicLink,
        expiresInHours: result.expiresInHours ?? 24,
        isFirstTime: true // a freshly-invited co-pilot has no password yet
      });
      const res = await sendEmail({
        to: result.email!,
        subject: mail.subject,
        text: mail.text,
        html: mail.html
      });
      emailSent = res.sent;
    } catch {
      emailSent = false;
    }
  }

  return NextResponse.json({ ...result, emailSent });
}
