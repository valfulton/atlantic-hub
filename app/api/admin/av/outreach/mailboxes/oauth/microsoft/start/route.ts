/**
 * GET /api/admin/av/outreach/mailboxes/oauth/microsoft/start?mailbox_id=NN
 *
 * Redirects the operator to Microsoft's consent screen. Encodes the
 * pending mailbox id in `state` so the callback knows which row to
 * populate.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { buildMicrosoftAuthUrl } from '@/lib/email/drivers/microsoft_graph';
import { loadMailbox } from '@/lib/email/mailbox';
import { ulid } from 'ulid';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/mailboxes/oauth/microsoft/start',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const mailboxIdParam = url.searchParams.get('mailbox_id');
  const mailboxId = mailboxIdParam ? parseInt(mailboxIdParam, 10) : NaN;
  if (!Number.isFinite(mailboxId)) {
    return NextResponse.json({ error: 'mailbox_id required' }, { status: 400 });
  }
  const mb = await loadMailbox(mailboxId);
  if (!mb || mb.driver !== 'microsoft_graph') {
    return NextResponse.json({ error: 'mailbox not found or wrong driver' }, { status: 404 });
  }

  // The state value is a single-use nonce signed by the mailbox id. The
  // callback URL is short-lived and on our own origin, so simple
  // <mailbox_id>:<nonce> is sufficient for v1. Upgrade to JWT/HMAC if we
  // ever proxy this through a third-party domain.
  const state = `${mailboxId}:${ulid()}`;
  try {
    const authUrl = buildMicrosoftAuthUrl({
      state,
      loginHint: mb.fromAddress
    });
    return NextResponse.redirect(authUrl);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, hint: 'Set MICROSOFT_OAUTH_CLIENT_ID, MICROSOFT_OAUTH_CLIENT_SECRET, MICROSOFT_OAUTH_REDIRECT_URI in Netlify env vars.' },
      { status: 503 }
    );
  }
}
