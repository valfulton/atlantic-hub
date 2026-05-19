/**
 * GET /api/admin/av/outreach/mailboxes/oauth/google/start?mailbox_id=NN
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { buildGoogleAuthUrl } from '@/lib/email/drivers/gmail';
import { loadMailbox } from '@/lib/email/mailbox';
import { ulid } from 'ulid';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/mailboxes/oauth/google/start',
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
  if (!mb || mb.driver !== 'gmail_api') {
    return NextResponse.json({ error: 'mailbox not found or wrong driver' }, { status: 404 });
  }
  const state = `${mailboxId}:${ulid()}`;
  try {
    const authUrl = buildGoogleAuthUrl({ state, loginHint: mb.fromAddress });
    return NextResponse.redirect(authUrl);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, hint: 'Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI in Netlify env vars.' },
      { status: 503 }
    );
  }
}
