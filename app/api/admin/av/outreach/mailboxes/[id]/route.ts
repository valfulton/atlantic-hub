/**
 * /api/admin/av/outreach/mailboxes/[id]
 *
 * GET    -> single mailbox (metadata only, no creds)
 * DELETE -> archive the mailbox (soft delete; preserves outreach history)
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { archiveMailbox, loadMailbox } from '@/lib/email/mailbox';
import { logEvent } from '@/lib/events/log';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/mailboxes/[id]',
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
  return NextResponse.json({
    mailbox: {
      id: mb.id,
      displayName: mb.displayName,
      fromAddress: mb.fromAddress,
      fromName: mb.fromName,
      replyToAddress: mb.replyToAddress,
      driver: mb.driver,
      status: mb.status,
      dailySendCount: mb.dailySendCount,
      dailySendResetAt: mb.dailySendResetAt,
      lastTestAt: mb.lastTestAt,
      lastTestOutcome: mb.lastTestOutcome,
      lastError: mb.lastError,
      createdAt: mb.createdAt,
      updatedAt: mb.updatedAt
    }
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/mailboxes/[id]',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  // Archiving credentials is OWNER ONLY -- staff can use a mailbox but can't disconnect it.
  if (guard.actor.role !== 'owner') {
    return NextResponse.json({ error: 'owner only' }, { status: 403 });
  }
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  await archiveMailbox(id);
  await logEvent({
    eventType: 'outreach.mailbox_archived',
    userId: guard.actor.userId,
    source: 'outreach',
    payload: { mailbox_id: id }
  });
  return NextResponse.json({ ok: true });
}
