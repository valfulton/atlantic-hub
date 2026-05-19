/**
 * GET /api/admin/av/outreach/mailboxes/oauth/google/callback?code=...&state=...
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { exchangeGoogleCode, GmailConfigError } from '@/lib/email/drivers/gmail';
import { loadMailbox, updateMailboxCredentials } from '@/lib/email/mailbox';
import { logEvent } from '@/lib/events/log';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/mailboxes/oauth/google/callback',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');
  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/admin/av/outreach/mailboxes?oauth_error=${encodeURIComponent(errorParam)}`, req.url)
    );
  }
  if (!code || !state) {
    return NextResponse.json({ error: 'missing code or state' }, { status: 400 });
  }
  const [mailboxIdStr] = state.split(':');
  const mailboxId = parseInt(mailboxIdStr, 10);
  if (!Number.isFinite(mailboxId)) {
    return NextResponse.json({ error: 'malformed state' }, { status: 400 });
  }
  const mb = await loadMailbox(mailboxId);
  if (!mb || mb.driver !== 'gmail_api') {
    return NextResponse.json({ error: 'mailbox not found or wrong driver' }, { status: 404 });
  }

  try {
    const creds = await exchangeGoogleCode({ code });
    await updateMailboxCredentials({
      mailboxId,
      credentials: creds,
      status: 'active'
    });
    await logEvent({
      eventType: 'outreach.mailbox_connected',
      userId: guard.actor.userId,
      source: 'outreach',
      payload: {
        mailbox_id: mailboxId,
        driver: 'gmail_api',
        email_address: creds.emailAddress
      }
    });
    return NextResponse.redirect(
      new URL(`/admin/av/outreach/mailboxes?connected=${mailboxId}`, req.url)
    );
  } catch (err) {
    if (err instanceof GmailConfigError) {
      return NextResponse.json(
        {
          error: err.message,
          hint: 'Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI in Netlify env vars.'
        },
        { status: 503 }
      );
    }
    await logEvent({
      eventType: 'outreach.mailbox_connect_failed',
      userId: guard.actor.userId,
      source: 'outreach',
      status: 'failure',
      errorMessage: (err as Error).message,
      payload: { mailbox_id: mailboxId, driver: 'gmail_api' }
    });
    return NextResponse.redirect(
      new URL(
        `/admin/av/outreach/mailboxes?oauth_error=${encodeURIComponent((err as Error).message)}`,
        req.url
      )
    );
  }
}
