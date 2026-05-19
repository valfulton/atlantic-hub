/**
 * lib/email/send_pipeline.ts
 *
 * Orchestrates the actual "approve a draft and send it" flow. Pure
 * server code -- routes call this; the cron also calls this (for
 * any future scheduled-send feature).
 *
 *   1. Load the message + campaign + mailbox
 *   2. Enforce per-mailbox + per-campaign + per-tier daily caps
 *   3. Build the send payload (To, Subject, Body, threading headers)
 *   4. Dispatch to the appropriate driver
 *   5. Persist the outcome to outreach_messages + outreach_send_log
 *   6. If campaign.auto_advance_stage and outcome=success, flip
 *      leads.lead_status from 'new' to 'contacted'.
 *   7. logEvent for every send attempt
 */

import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { ulid } from 'ulid';

import { loadMailbox, incrementDailySend } from '@/lib/email/mailbox';
import { getDriverFor } from '@/lib/email/router';
import { checkCampaignCap, checkTierCap, type TierForLimits } from '@/lib/email/limits';
import { logEvent } from '@/lib/events/log';
import type {
  MailboxRecord,
  SendMessageInput,
  SendMessageResult,
  SendOutcome
} from '@/lib/email/types';

export interface SendDraftArgs {
  messageId: number;
  approverUserId: number | null;
  /** Tier for the cap check. For val (operator) pass 'operator'. */
  tier: TierForLimits;
}

export interface SendDraftResult {
  ok: boolean;
  outcome: SendOutcome | 'capped' | 'not_found' | 'not_pending';
  message: string;
  providerMessageId?: string | null;
  sentAt?: string;
}

interface MessageRow extends RowDataPacket {
  id: number;
  campaign_id: number;
  lead_id: number;
  mailbox_id: number;
  sequence_step: number;
  subject: string;
  body: string;
  body_format: 'plaintext' | 'html';
  status: string;
}

interface CampaignRow extends RowDataPacket {
  id: number;
  mailbox_id: number;
  name: string;
  daily_send_limit: number;
  auto_advance_stage: number;
  require_approval: number;
  status: string;
}

interface LeadRow extends RowDataPacket {
  id: number;
  email: string;
  contact_name: string | null;
  lead_status: string;
}

export async function sendDraft(args: SendDraftArgs): Promise<SendDraftResult> {
  const db = getAvDb();

  const [msgRows] = await db.execute<MessageRow[]>(
    `SELECT id, campaign_id, lead_id, mailbox_id, sequence_step, subject, body, body_format, status
       FROM outreach_messages
      WHERE id = ?
      LIMIT 1`,
    [args.messageId]
  );
  const msg = msgRows[0];
  if (!msg) {
    return { ok: false, outcome: 'not_found', message: `message ${args.messageId} not found` };
  }
  if (msg.status !== 'pending_approval' && msg.status !== 'approved' && msg.status !== 'draft') {
    return {
      ok: false,
      outcome: 'not_pending',
      message: `message status is "${msg.status}" -- can only send pending/approved/draft`
    };
  }

  const [campRows] = await db.execute<CampaignRow[]>(
    `SELECT id, mailbox_id, name, daily_send_limit, auto_advance_stage, require_approval, status
       FROM outreach_campaigns
      WHERE id = ? AND archived_at IS NULL
      LIMIT 1`,
    [msg.campaign_id]
  );
  const campaign = campRows[0];
  if (!campaign) {
    return { ok: false, outcome: 'not_found', message: `campaign ${msg.campaign_id} not found` };
  }
  if (campaign.status === 'paused' || campaign.status === 'archived') {
    return {
      ok: false,
      outcome: 'not_pending',
      message: `campaign is ${campaign.status} -- cannot send`
    };
  }

  const [leadRows] = await db.execute<LeadRow[]>(
    `SELECT id, email, contact_name, lead_status
       FROM leads
      WHERE id = ? AND archived_at IS NULL
      LIMIT 1`,
    [msg.lead_id]
  );
  const lead = leadRows[0];
  if (!lead || !lead.email) {
    return {
      ok: false,
      outcome: 'invalid_recipient',
      message: `lead ${msg.lead_id} missing or has no email`
    };
  }

  const mailbox = await loadMailbox(msg.mailbox_id);
  if (!mailbox) {
    return {
      ok: false,
      outcome: 'not_found',
      message: `mailbox ${msg.mailbox_id} not found or archived`
    };
  }
  if (mailbox.status !== 'active') {
    return {
      ok: false,
      outcome: 'auth_error',
      message: `mailbox status is "${mailbox.status}" -- reconnect required`
    };
  }

  // --- Cap checks -----------------------------------------------------
  const sentTodayMailbox = await countSendsToday({ mailboxId: mailbox.id });
  const sentTodayCampaign = await countSendsToday({ campaignId: campaign.id });

  const tierCheck = checkTierCap({ tier: args.tier, sentToday: sentTodayMailbox });
  if (!tierCheck.allowed) {
    await markFailed(msg.id, 'capped', tierCheck.reason ?? 'tier cap reached');
    return { ok: false, outcome: 'capped', message: tierCheck.reason ?? 'tier cap reached' };
  }
  const campaignCheck = checkCampaignCap({
    campaignLimit: campaign.daily_send_limit,
    sentTodayInCampaign: sentTodayCampaign
  });
  if (!campaignCheck.allowed) {
    await markFailed(msg.id, 'capped', campaignCheck.reason ?? 'campaign cap reached');
    return { ok: false, outcome: 'capped', message: campaignCheck.reason ?? 'campaign cap reached' };
  }

  // --- Build + send ---------------------------------------------------
  const ourMessageId = `${ulid()}.outreach@atlantic-hub`;
  const driver = getDriverFor(mailbox);
  const input: SendMessageInput = {
    to: lead.email,
    toName: lead.contact_name || undefined,
    subject: msg.subject,
    bodyPlain: msg.body,
    bodyHtml: msg.body_format === 'html' ? msg.body : undefined,
    ourMessageId
  };

  let result: SendMessageResult;
  try {
    result = await driver.sendMessage(mailbox, input);
  } catch (err) {
    const e = err as Error;
    result = {
      outcome: 'other_error',
      providerMessageId: null,
      providerResponse: null,
      latencyMs: 0,
      errorMessage: e.message
    };
  }

  // --- Persist outcome ------------------------------------------------
  await db.execute<ResultSetHeader>(
    `INSERT INTO outreach_send_log
       (message_id, mailbox_id, driver, outcome, provider_response, latency_ms,
        error_message, actor_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      msg.id,
      mailbox.id,
      mailbox.driver,
      result.outcome,
      result.providerResponse?.slice(0, 5000) ?? null,
      result.latencyMs,
      result.errorMessage,
      args.approverUserId
    ]
  );

  if (result.outcome === 'success') {
    await db.execute<ResultSetHeader>(
      `UPDATE outreach_messages
          SET status = 'sent',
              approved_by_user_id = COALESCE(approved_by_user_id, ?),
              approved_at = COALESCE(approved_at, NOW()),
              sent_at = NOW(),
              provider_message_id = ?,
              error_message = NULL,
              updated_at = NOW()
        WHERE id = ?`,
      [args.approverUserId, result.providerMessageId, msg.id]
    );
    await incrementDailySend(mailbox.id);

    // Auto-advance lead_status: new -> contacted
    if (campaign.auto_advance_stage === 1 && lead.lead_status === 'new') {
      await db.execute<ResultSetHeader>(
        `UPDATE leads
            SET lead_status = 'contacted',
                last_activity_at = NOW(),
                updated_at = NOW()
          WHERE id = ?`,
        [lead.id]
      );
      await logEvent({
        eventType: 'lead.stage_advanced',
        leadId: lead.id,
        source: 'outreach',
        payload: { from: 'new', to: 'contacted', reason: 'outreach.sent', message_id: msg.id }
      });
    }

    await logEvent({
      eventType: 'outreach.sent',
      leadId: lead.id,
      source: 'outreach',
      executionTimeMs: result.latencyMs,
      payload: {
        message_id: msg.id,
        campaign_id: campaign.id,
        mailbox_id: mailbox.id,
        driver: mailbox.driver,
        provider_message_id: result.providerMessageId
      }
    });

    return {
      ok: true,
      outcome: 'success',
      message: 'sent',
      providerMessageId: result.providerMessageId,
      sentAt: new Date().toISOString()
    };
  }

  // Failure path
  await db.execute<ResultSetHeader>(
    `UPDATE outreach_messages
        SET status = 'failed',
            error_message = ?,
            updated_at = NOW()
      WHERE id = ?`,
    [result.errorMessage?.slice(0, 500) ?? 'unknown send error', msg.id]
  );
  await logEvent({
    eventType: 'outreach.send_failed',
    leadId: lead.id,
    source: 'outreach',
    status: 'failure',
    executionTimeMs: result.latencyMs,
    errorMessage: result.errorMessage ?? undefined,
    payload: {
      message_id: msg.id,
      campaign_id: campaign.id,
      mailbox_id: mailbox.id,
      driver: mailbox.driver,
      outcome: result.outcome
    }
  });
  return {
    ok: false,
    outcome: result.outcome,
    message: result.errorMessage ?? `send failed with outcome=${result.outcome}`
  };
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

async function countSendsToday(args: {
  mailboxId?: number;
  campaignId?: number;
}): Promise<number> {
  const db = getAvDb();
  const where: string[] = [`outcome = 'success'`, `attempted_at >= CURDATE()`];
  const params: unknown[] = [];
  if (args.mailboxId) {
    where.push(`mailbox_id = ?`);
    params.push(args.mailboxId);
  }
  if (args.campaignId) {
    where.push(`message_id IN (SELECT id FROM outreach_messages WHERE campaign_id = ?)`);
    params.push(args.campaignId);
  }
  const [rows] = await db.execute<(RowDataPacket & { n: number })[]>(
    `SELECT COUNT(*) AS n FROM outreach_send_log WHERE ${where.join(' AND ')}`,
    params
  );
  return rows[0]?.n ?? 0;
}

async function markFailed(messageId: number, outcome: string, reason: string): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `UPDATE outreach_messages
        SET status = 'failed',
            error_message = ?,
            updated_at = NOW()
      WHERE id = ?`,
    [`${outcome}: ${reason}`.slice(0, 500), messageId]
  );
}

export interface RejectDraftArgs {
  messageId: number;
  rejecterUserId: number | null;
  reason: string | null;
}

export async function rejectDraft(args: RejectDraftArgs): Promise<{ ok: boolean; message: string }> {
  const db = getAvDb();
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE outreach_messages
        SET status = 'rejected',
            rejection_reason = ?,
            approved_by_user_id = ?,
            updated_at = NOW()
      WHERE id = ? AND status IN ('draft','pending_approval','approved')`,
    [args.reason?.slice(0, 500) ?? null, args.rejecterUserId, args.messageId]
  );
  if (res.affectedRows === 0) {
    return { ok: false, message: 'message not in a rejectable state' };
  }
  await logEvent({
    eventType: 'outreach.rejected',
    source: 'outreach',
    userId: args.rejecterUserId ?? null,
    payload: { message_id: args.messageId, reason: args.reason }
  });
  return { ok: true, message: 'rejected' };
}
