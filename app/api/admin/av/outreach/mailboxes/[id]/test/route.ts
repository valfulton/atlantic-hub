/**
 * POST /api/admin/av/outreach/mailboxes/[id]/test
 *
 * Exercise the mailbox credentials (SMTP HELO or OAuth whoami) and
 * write the outcome back to outreach_mailboxes.last_test_*.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { loadMailbox, updateMailboxTestOutcome } from '@/lib/email/mailbox';
import { getDriverFor } from '@/lib/email/router';
import { logEvent } from '@/lib/events/log';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/mailboxes/[id]/test',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const mb = await loadMailbox(id);
  if (!mb) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!mb.credentials) {
    return NextResponse.json(
      {
        ok: false,
        outcome: 'auth_error',
        message: 'mailbox has no credentials yet -- complete the OAuth handshake first'
      },
      { status: 200 }
    );
  }

  const driver = getDriverFor(mb);
  const result = await driver.testConnection(mb);
  await updateMailboxTestOutcome({
    mailboxId: id,
    ok: result.ok,
    outcome: result.outcome,
    message: result.message
  });
  await logEvent({
    eventType: result.ok ? 'outreach.mailbox_test_ok' : 'outreach.mailbox_test_failed',
    userId: guard.actor.userId,
    source: 'outreach',
    status: result.ok ? 'success' : 'failure',
    executionTimeMs: result.latencyMs,
    errorMessage: result.ok ? undefined : result.message,
    payload: { mailbox_id: id, driver: mb.driver, outcome: result.outcome }
  });
  return NextResponse.json({
    ok: result.ok,
    outcome: result.outcome,
    message: result.message,
    latencyMs: result.latencyMs
  });
}
