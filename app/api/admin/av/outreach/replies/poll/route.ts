// CRON-ONLY — invoked by Netlify/worker schedule (some also via a manual "run now" button).
// Zero/limited in-app fetch call sites is BY DESIGN. Do NOT delete in a dead-code sweep.
// See Atlantic_Hub_Playbook/Hidden_Pages_Audit.md (PR A).

/**
 * POST /api/admin/av/outreach/replies/poll
 *
 * Poll every reply-capable mailbox for new replies since its most-recent
 * outreach_replies.received_at, classify each new reply, persist, and
 * advance lead_status where appropriate. Owner/staff can trigger
 * manually from the UI; a Netlify scheduled function calls it every
 * 15 minutes (see netlify/functions/outreach-poll-cron.mts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { listMailboxes } from '@/lib/email/mailbox';
import { driverSupportsReplyPolling, getDriverFor } from '@/lib/email/router';
import { processReplies } from '@/lib/email/reply_processor';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  // Either the cron secret OR an admin session is accepted. The cron
  // secret reuses ENRICHMENT_CRON_SECRET to avoid managing yet another secret.
  const cronSecret = req.headers.get('x-cron-secret');
  const expectedSecret = process.env.ENRICHMENT_CRON_SECRET;
  let actorUserId: number | null = null;
  if (cronSecret && expectedSecret && cronSecret === expectedSecret) {
    // cron path -- skip session check
  } else {
    const guard = await guardAdminRequest(req, {
      targetResource: '/api/admin/av/outreach/replies/poll',
      tenantId: 'av'
    });
    if (!guard.ok) return guard.response;
    if (guard.actor.role === 'client_user') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    actorUserId = guard.actor.userId;
  }

  const db = getAvDb();
  const mailboxes = await listMailboxes({ organizationId: null });
  const summary: Array<{
    mailboxId: number;
    driver: string;
    fetched: number;
    processed: number;
    positive: number;
    error?: string;
  }> = [];

  for (const mb of mailboxes) {
    if (mb.status !== 'active') continue;
    if (!driverSupportsReplyPolling(mb.driver)) {
      summary.push({ mailboxId: mb.id, driver: mb.driver, fetched: 0, processed: 0, positive: 0 });
      continue;
    }
    const [latest] = await db.execute<(RowDataPacket & { latest_at: string | null })[]>(
      `SELECT MAX(received_at) AS latest_at FROM outreach_replies WHERE mailbox_id = ?`,
      [mb.id]
    );
    const since = latest[0]?.latest_at ? new Date(latest[0].latest_at) : null;

    try {
      const driver = getDriverFor(mb);
      const replies = await driver.fetchReplies(mb, since);
      const outcomes = await processReplies({ mailbox: mb, replies });
      const positive = outcomes.filter((o) => o.classification === 'positive').length;
      summary.push({
        mailboxId: mb.id,
        driver: mb.driver,
        fetched: replies.length,
        processed: outcomes.filter((o) => o.inserted).length,
        positive
      });
    } catch (err) {
      const msg = (err as Error).message;
      summary.push({
        mailboxId: mb.id,
        driver: mb.driver,
        fetched: 0,
        processed: 0,
        positive: 0,
        error: msg
      });
      await logEvent({
        eventType: 'outreach.reply_poll_failed',
        source: 'outreach',
        status: 'failure',
        errorMessage: msg,
        payload: { mailbox_id: mb.id, driver: mb.driver }
      });
    }
  }

  await logEvent({
    eventType: 'outreach.reply_poll_run',
    source: 'outreach',
    userId: actorUserId,
    payload: { mailboxes: summary }
  });
  return NextResponse.json({ ok: true, summary });
}
