/**
 * lib/email/reply_processor.ts
 *
 * Take fresh InboundReply rows from a driver, match them back to the
 * outreach_messages row they're replying to, classify them with AI,
 * persist into outreach_replies, advance lead_status where appropriate,
 * and log events.
 *
 * Idempotent on providerMessageId -- safe to re-run the same batch.
 */

import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import { classifyReply, type ReplyClassification } from '@/lib/ai/reply_classifier';
import { logEvent } from '@/lib/events/log';
import type { InboundReply, MailboxRecord } from '@/lib/email/types';

export interface ProcessReplyOutcome {
  providerMessageId: string;
  classification: ReplyClassification;
  matchedMessageId: number | null;
  matchedLeadId: number | null;
  stageAdvancedFrom: string | null;
  stageAdvancedTo: string | null;
  inserted: boolean;
  skipReason?: string;
}

export async function processReplies(args: {
  mailbox: MailboxRecord;
  replies: InboundReply[];
}): Promise<ProcessReplyOutcome[]> {
  const out: ProcessReplyOutcome[] = [];
  for (const r of args.replies) {
    out.push(await processOne({ mailbox: args.mailbox, reply: r }));
  }
  return out;
}

async function processOne(args: {
  mailbox: MailboxRecord;
  reply: InboundReply;
}): Promise<ProcessReplyOutcome> {
  const db = getAvDb();

  // 1. Match back to an outbound message via In-Reply-To header.
  let matchedMessageId: number | null = null;
  let matchedLeadId: number | null = null;
  let matchedCampaignId: number | null = null;
  let campaignAutoAdvance = false;
  if (args.reply.inReplyTo) {
    const variants = [
      args.reply.inReplyTo,
      args.reply.inReplyTo.replace(/^<|>$/g, ''),
      `<${args.reply.inReplyTo.replace(/^<|>$/g, '')}>`
    ];
    const placeholders = variants.map(() => '?').join(',');
    const [rows] = await db.execute<
      (RowDataPacket & {
        id: number;
        lead_id: number;
        campaign_id: number;
        auto_advance_stage: number;
      })[]
    >(
      `SELECT m.id, m.lead_id, m.campaign_id, c.auto_advance_stage
         FROM outreach_messages m
         JOIN outreach_campaigns c ON c.id = m.campaign_id
        WHERE m.provider_message_id IN (${placeholders})
        ORDER BY m.sent_at DESC
        LIMIT 1`,
      variants
    );
    if (rows[0]) {
      matchedMessageId = rows[0].id;
      matchedLeadId = rows[0].lead_id;
      matchedCampaignId = rows[0].campaign_id;
      campaignAutoAdvance = rows[0].auto_advance_stage === 1;
    }
  }

  // 2. Skip duplicates on providerMessageId.
  const [dup] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM outreach_replies WHERE in_reply_to_header = ? AND reply_from = ? LIMIT 1`,
    [args.reply.inReplyTo ?? null, args.reply.fromAddress]
  );
  if (dup[0] && args.reply.inReplyTo) {
    return {
      providerMessageId: args.reply.providerMessageId,
      classification: 'unknown',
      matchedMessageId,
      matchedLeadId,
      stageAdvancedFrom: null,
      stageAdvancedTo: null,
      inserted: false,
      skipReason: 'duplicate'
    };
  }

  // 3. Classify.
  const classified = await classifyReply({
    fromAddress: args.reply.fromAddress,
    subject: args.reply.subject,
    bodyPlain: args.reply.bodyPlain
  });

  // 4. Insert outreach_replies row.
  await db.execute<ResultSetHeader>(
    `INSERT INTO outreach_replies
       (message_id, lead_id, campaign_id, mailbox_id, reply_from, reply_subject,
        reply_body, in_reply_to_header, classification, classification_confidence,
        classifier_model, received_at, raw_payload, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      matchedMessageId,
      matchedLeadId,
      matchedCampaignId,
      args.mailbox.id,
      args.reply.fromAddress,
      args.reply.subject?.slice(0, 500) ?? null,
      args.reply.bodyPlain.slice(0, 64_000),
      args.reply.inReplyTo,
      classified.classification,
      classified.confidence,
      classified.model,
      args.reply.receivedAt,
      JSON.stringify(args.reply.rawPayload)
    ]
  );

  // 5. Update the matched outbound message status if positive/interested/negative.
  let stageAdvancedFrom: string | null = null;
  let stageAdvancedTo: string | null = null;
  if (matchedMessageId && matchedLeadId) {
    const newStatus = mapClassificationToMessageStatus(classified.classification);
    if (newStatus) {
      await db.execute<ResultSetHeader>(
        `UPDATE outreach_messages SET status = ?, replied_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [newStatus, matchedMessageId]
      );
    }

    if (campaignAutoAdvance) {
      const advance = mapClassificationToStageAdvance(classified.classification);
      if (advance) {
        const [leadRows] = await db.execute<(RowDataPacket & { lead_status: string })[]>(
          `SELECT lead_status FROM leads WHERE id = ? LIMIT 1`,
          [matchedLeadId]
        );
        const current = leadRows[0]?.lead_status ?? null;
        if (current && advance.from.includes(current) && current !== advance.to) {
          await db.execute<ResultSetHeader>(
            `UPDATE leads SET lead_status = ?, last_activity_at = NOW(), updated_at = NOW() WHERE id = ?`,
            [advance.to, matchedLeadId]
          );
          stageAdvancedFrom = current;
          stageAdvancedTo = advance.to;
          await logEvent({
            eventType: 'lead.stage_advanced',
            leadId: matchedLeadId,
            source: 'outreach',
            payload: {
              from: current,
              to: advance.to,
              reason: `outreach.replied:${classified.classification}`,
              message_id: matchedMessageId
            }
          });
        }
      }
    }
  }

  await logEvent({
    eventType: 'outreach.replied',
    leadId: matchedLeadId,
    source: 'outreach',
    payload: {
      classification: classified.classification,
      confidence: classified.confidence,
      message_id: matchedMessageId,
      mailbox_id: args.mailbox.id,
      driver: args.mailbox.driver,
      from: args.reply.fromAddress
    }
  });

  return {
    providerMessageId: args.reply.providerMessageId,
    classification: classified.classification,
    matchedMessageId,
    matchedLeadId,
    stageAdvancedFrom,
    stageAdvancedTo,
    inserted: true
  };
}

function mapClassificationToMessageStatus(
  c: ReplyClassification
): 'replied' | 'bounced' | null {
  if (c === 'autoresponder') return null;
  if (c === 'unsubscribe') return 'replied';
  return 'replied';
}

function mapClassificationToStageAdvance(
  c: ReplyClassification
): { from: string[]; to: string } | null {
  switch (c) {
    case 'positive':
      return { from: ['new', 'contacted'], to: 'qualified' };
    case 'interested':
      return { from: ['new'], to: 'contacted' };
    case 'negative':
      return { from: ['new', 'contacted'], to: 'lost' };
    case 'unsubscribe':
      return { from: ['new', 'contacted', 'qualified'], to: 'lost' };
    default:
      return null;
  }
}
