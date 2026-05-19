/**
 * /api/admin/av/outreach/mailboxes
 *
 * GET  -> list connected mailboxes (no decrypted creds in the response)
 * POST -> create a new mailbox.
 *
 *   For driver=hostgator_smtp the body includes host/port/secure/user/pass.
 *   For driver=microsoft_graph or gmail_api the POST creates a pending
 *   row only; the actual credentials populate via the OAuth callback.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { createMailbox, listMailboxes } from '@/lib/email/mailbox';
import { logEvent } from '@/lib/events/log';
import type {
  HostGatorSmtpCredentials,
  MailDriverKind,
  MailboxRecord
} from '@/lib/email/types';

export const runtime = 'nodejs';

const VALID_DRIVERS: ReadonlySet<MailDriverKind> = new Set([
  'hostgator_smtp',
  'microsoft_graph',
  'gmail_api'
]);

interface CreateBody {
  driver: MailDriverKind;
  displayName: string;
  fromAddress: string;
  fromName?: string | null;
  replyToAddress?: string | null;
  // hostgator_smtp only
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  imapHost?: string;
  imapPort?: number;
}

function strip(m: MailboxRecord) {
  // Strip credentials from the API response. UI only ever needs metadata.
  return {
    id: m.id,
    displayName: m.displayName,
    fromAddress: m.fromAddress,
    fromName: m.fromName,
    replyToAddress: m.replyToAddress,
    driver: m.driver,
    status: m.status,
    dailySendCount: m.dailySendCount,
    dailySendResetAt: m.dailySendResetAt,
    lastTestAt: m.lastTestAt,
    lastTestOutcome: m.lastTestOutcome,
    lastError: m.lastError,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt
  };
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/mailboxes',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const mailboxes = await listMailboxes({ organizationId: null });
  return NextResponse.json({ mailboxes: mailboxes.map(strip) });
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/mailboxes',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  if (!VALID_DRIVERS.has(body.driver)) {
    return NextResponse.json({ error: 'invalid driver' }, { status: 400 });
  }
  if (!body.displayName || !body.fromAddress) {
    return NextResponse.json({ error: 'displayName and fromAddress required' }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.fromAddress)) {
    return NextResponse.json({ error: 'fromAddress not a valid email' }, { status: 400 });
  }

  if (body.driver === 'hostgator_smtp') {
    if (!body.host || !body.port || !body.user || !body.pass) {
      return NextResponse.json(
        { error: 'host, port, user, pass required for hostgator_smtp' },
        { status: 400 }
      );
    }
    const creds: HostGatorSmtpCredentials = {
      kind: 'hostgator_smtp',
      host: body.host,
      port: body.port,
      secure: body.secure ?? body.port === 465,
      user: body.user,
      pass: body.pass,
      imapHost: body.imapHost,
      imapPort: body.imapPort
    };
    const id = await createMailbox({
      organizationId: null,
      displayName: body.displayName,
      fromAddress: body.fromAddress,
      fromName: body.fromName ?? null,
      replyToAddress: body.replyToAddress ?? null,
      driver: 'hostgator_smtp',
      credentials: creds,
      // SMTP is active immediately; we'll exercise the connection on the next
      // "Test connection" click. UI prompts to test before sending.
      status: 'active',
      createdByUserId: guard.actor.userId
    });
    await logEvent({
      eventType: 'outreach.mailbox_created',
      userId: guard.actor.userId,
      source: 'outreach',
      payload: { mailbox_id: id, driver: 'hostgator_smtp' }
    });
    return NextResponse.json({ ok: true, mailboxId: id });
  }

  // OAuth drivers: insert a pending row, then redirect the user to the
  // OAuth start route which sets credentials_encrypted on callback.
  const id = await createMailbox({
    organizationId: null,
    displayName: body.displayName,
    fromAddress: body.fromAddress,
    fromName: body.fromName ?? null,
    replyToAddress: body.replyToAddress ?? null,
    driver: body.driver,
    credentials: null,
    status: 'pending_oauth',
    createdByUserId: guard.actor.userId
  });
  await logEvent({
    eventType: 'outreach.mailbox_created',
    userId: guard.actor.userId,
    source: 'outreach',
    payload: { mailbox_id: id, driver: body.driver, pending_oauth: true }
  });
  const oauthStartUrl =
    body.driver === 'microsoft_graph'
      ? `/api/admin/av/outreach/mailboxes/oauth/microsoft/start?mailbox_id=${id}`
      : `/api/admin/av/outreach/mailboxes/oauth/google/start?mailbox_id=${id}`;
  return NextResponse.json({ ok: true, mailboxId: id, oauthStartUrl });
}
