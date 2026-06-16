/**
 * /api/admin/inbox/imap-poll  (val 2026-06-16, #707)
 *
 * IMAP poller endpoint. Called every 5 minutes by HostGator cron with the
 * shared-secret header. Pulls unseen messages from inbox@case + inbox@pr,
 * routes by To: header, writes the audit row + (for cases) the case_note,
 * then marks the IMAP message as \Seen so the next call skips it.
 *
 * Auth: same X-Cron-Secret pattern as /api/admin/social/publish-due.
 * Env: INBOUND_EMAIL_CRON_SECRET must be set in Netlify and the cron line
 *      header value must match.
 *
 * Runtime: nodejs (imapflow needs Node), maxDuration 60s (Netlify ceiling).
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { pollAllMailboxes } from '@/lib/imap/poll';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function unauthorized(reason: string) {
  return NextResponse.json({ ok: false, error: reason }, { status: 401 });
}

async function handle(req: NextRequest) {
  const expected = process.env.INBOUND_EMAIL_CRON_SECRET;
  const got = req.headers.get('x-cron-secret');
  if (!expected) return unauthorized('INBOUND_EMAIL_CRON_SECRET not set');
  if (!got || got !== expected) return unauthorized('bad x-cron-secret');
  try {
    const summary = await pollAllMailboxes();
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
