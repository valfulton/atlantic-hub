/**
 * lib/ai/outreach_drafter.ts
 *
 * Generate a personalized outreach email draft for one lead, grounded
 * in the lead's own audit_content. This is the closer in the pipeline:
 * lead in -> draft out, ready for one-click approval.
 *
 * Used by:
 *   - POST /api/admin/av/outreach/draft/[audit_id]
 *   - (future) batch drafter that runs after every fresh ai.lead_scored
 *
 * Output is constrained JSON (subject + body + grounded_excerpt). Subject
 * 35-60 chars, body 80-150 words. Single specific observation pulled from
 * the audit + clear CTA + signature.
 *
 * Brand voice: PLURAL ("our team", "our platform") -- never founder name.
 * See docs/PRODUCT_VISION.md "BRAND VOICE" section.
 *
 * Cost: ~$0.005-0.010 per draft (gpt-4o-mini at ~1000-token completion).
 */

import { getAvDb } from '@/lib/db/av';
import {
  openaiChatCompletion,
  parseOpenAIJson,
  OpenAIKeyMissingError,
  OpenAIApiError
} from '@/lib/openai/client';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const MODEL = 'gpt-4o-mini';
const TEMPERATURE = 0.7;
const MAX_TOKENS = 700;

// Trim audit content to keep prompts cheap and focused. 1500 chars is enough
// for the AI to find one specific observation worth quoting.
const AUDIT_EXCERPT_MAX_CHARS = 1500;

export interface OutreachDraftCampaignContext {
  campaignId: number;
  campaignName: string;
  offerSummary: string | null;
  cta: string | null;
  signature: string | null;
  /** Display name to use in From: -- typically the mailbox's from_name */
  senderDisplayName: string;
}

export interface OutreachDraftResult {
  subject: string;
  body: string;
  /** The snippet from the audit the draft hooks onto, for operator review */
  groundedExcerpt: string | null;
  model: string;
  tokensUsed: number;
  temperature: number;
  /** True if audit_content was used; false if we had to fall back to industry/company */
  groundedOnAudit: boolean;
}

export class OutreachDraftLeadNotFoundError extends Error {
  constructor(public auditId: string) {
    super(`Lead not found for audit_id=${auditId}`);
    this.name = 'OutreachDraftLeadNotFoundError';
  }
}

export class OutreachDraftInsufficientDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutreachDraftInsufficientDataError';
  }
}

interface LeadRow extends RowDataPacket {
  id: number;
  audit_id: string;
  company: string;
  contact_name: string | null;
  contact_title: string | null;
  email: string;
  industry: string | null;
  website: string | null;
  audit_content: string | null;
  challenge: string | null;
  ai_score: number | null;
  ai_score_band: 'hot' | 'warm' | 'cool' | null;
  ai_score_reason: string | null;
}

interface DraftJson {
  subject: string;
  body: string;
  grounded_excerpt?: string;
}

export async function generateOutreachDraft(args: {
  auditId: string;
  campaign: OutreachDraftCampaignContext;
}): Promise<OutreachDraftResult> {
  const lead = await loadLead(args.auditId);
  if (!lead) throw new OutreachDraftLeadNotFoundError(args.auditId);
  if (!lead.email) {
    throw new OutreachDraftInsufficientDataError(
      `Lead ${lead.id} (${lead.company}) has no email -- cannot draft outreach`
    );
  }

  const started = Date.now();
  const groundedOnAudit = !!(lead.audit_content && lead.audit_content.length > 50);
  const auditExcerpt = groundedOnAudit
    ? truncate(lead.audit_content!.trim(), AUDIT_EXCERPT_MAX_CHARS)
    : null;

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({ lead, campaign: args.campaign, auditExcerpt });

  let completion;
  try {
    completion = await openaiChatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      { model: MODEL, temperature: TEMPERATURE, maxTokens: MAX_TOKENS, json: true }
    );
  } catch (err) {
    if (err instanceof OpenAIKeyMissingError || err instanceof OpenAIApiError) {
      await logEvent({
        eventType: 'outreach.draft_failed',
        leadId: lead.id,
        source: 'openai',
        status: 'failure',
        errorMessage: err.message,
        payload: { campaign_id: args.campaign.campaignId }
      });
    }
    throw err;
  }

  const parsed = parseOpenAIJson<DraftJson>(completion.text);
  if (!parsed || typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') {
    await logEvent({
      eventType: 'outreach.draft_failed',
      leadId: lead.id,
      source: 'openai',
      status: 'failure',
      errorMessage: `parse error -- could not extract subject+body from JSON`,
      payload: {
        campaign_id: args.campaign.campaignId,
        raw_response_excerpt: completion.text.slice(0, 500)
      }
    });
    throw new Error(`OpenAI returned malformed JSON -- cannot draft outreach for lead ${lead.id}`);
  }

  const subject = clampSubject(parsed.subject);
  const body = parsed.body.trim();
  const groundedExcerpt = parsed.grounded_excerpt
    ? truncate(parsed.grounded_excerpt.trim(), 500)
    : null;

  await logEvent({
    eventType: 'outreach.drafted',
    leadId: lead.id,
    source: 'openai',
    executionTimeMs: Date.now() - started,
    payload: {
      campaign_id: args.campaign.campaignId,
      model: completion.model,
      tokens: completion.usage.totalTokens,
      grounded_on_audit: groundedOnAudit
    }
  });

  return {
    subject,
    body,
    groundedExcerpt,
    model: completion.model,
    tokensUsed: completion.usage.totalTokens,
    temperature: TEMPERATURE,
    groundedOnAudit
  };
}

// ---------------------------------------------------------------------
// Persistence helper -- used by the route layer to drop a draft into the
// approval queue. Returns the new outreach_messages.id.
// ---------------------------------------------------------------------

export async function insertDraftRow(args: {
  campaignId: number;
  leadId: number;
  mailboxId: number;
  draft: OutreachDraftResult;
  status?: 'draft' | 'pending_approval';
}): Promise<number> {
  const db = getAvDb();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO outreach_messages
       (campaign_id, lead_id, mailbox_id, sequence_step, subject, body,
        body_format, ai_model, ai_tokens_used, ai_temperature,
        ai_grounded_on_audit, status)
     VALUES (?, ?, ?, 1, ?, ?, 'plaintext', ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
        subject = VALUES(subject),
        body = VALUES(body),
        ai_model = VALUES(ai_model),
        ai_tokens_used = VALUES(ai_tokens_used),
        ai_temperature = VALUES(ai_temperature),
        ai_grounded_on_audit = VALUES(ai_grounded_on_audit),
        status = VALUES(status),
        updated_at = NOW()`,
    [
      args.campaignId,
      args.leadId,
      args.mailboxId,
      args.draft.subject,
      args.draft.body,
      args.draft.model,
      args.draft.tokensUsed,
      args.draft.temperature,
      args.draft.groundedOnAudit ? 1 : 0,
      args.status ?? 'pending_approval'
    ]
  );
  // ON DUPLICATE KEY UPDATE returns 0 for insertId; fall back to a SELECT.
  if (res.insertId && res.insertId > 0) return res.insertId;
  const db2 = getAvDb();
  const [rows] = await db2.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM outreach_messages
      WHERE campaign_id = ? AND lead_id = ? AND sequence_step = 1
      LIMIT 1`,
    [args.campaignId, args.leadId]
  );
  return rows[0]?.id ?? 0;
}

// ---------------------------------------------------------------------
// Internal: prompt construction
// ---------------------------------------------------------------------

function buildSystemPrompt(): string {
  return [
    `You write short, specific, human-feeling outreach emails for a marketing platform called Atlantic & Vine.`,
    ``,
    `RULES -- never break these:`,
    `1. Speak in PLURAL voice ("our team", "we", "our platform"). Never use a first-person singular "I" and never sign with a person's name. The signature is the sender_display_name supplied by the user.`,
    `2. Hook the email on ONE specific observation from the audit_excerpt. Do not summarize the whole audit. Pick one concrete thing (a broken meta tag, a missing local-SEO play, a weak CTA on the homepage, a content gap, a competitor angle, etc.) and reference it briefly.`,
    `3. Body 80-150 words. Subject 35-60 characters. Plain text only -- no HTML, no markdown formatting, no bullets.`,
    `4. End with the cta supplied by the user. If no cta is supplied, ask for a 15-minute call.`,
    `5. Sound like a person, not a corporate template. No "I hope this email finds you well." No "leveraging synergies." No "circle back."`,
    `6. Do not mention pricing, dollar amounts, or any per-unit API cost. Never reveal that the email was AI-generated.`,
    `7. If the audit_excerpt is empty, still produce a draft, but ground it in the company name + industry instead. Set grounded_excerpt to null in that case.`,
    ``,
    `RESPONSE FORMAT: respond with a JSON object exactly matching this shape and nothing else:`,
    `{`,
    `  "subject": "...",`,
    `  "body": "...",`,
    `  "grounded_excerpt": "..."   // the ~1 sentence from the audit that the body hooks onto, or null`,
    `}`
  ].join('\n');
}

function buildUserPrompt(args: {
  lead: LeadRow;
  campaign: OutreachDraftCampaignContext;
  auditExcerpt: string | null;
}): string {
  const { lead, campaign, auditExcerpt } = args;
  const parts: string[] = [];
  parts.push(`COMPANY: ${lead.company}`);
  if (lead.industry) parts.push(`INDUSTRY: ${lead.industry}`);
  if (lead.contact_name) parts.push(`CONTACT_NAME: ${lead.contact_name}`);
  if (lead.contact_title) parts.push(`CONTACT_TITLE: ${lead.contact_title}`);
  if (lead.website) parts.push(`WEBSITE: ${lead.website}`);
  parts.push(``);
  parts.push(`SENDER_DISPLAY_NAME: ${campaign.senderDisplayName}`);
  parts.push(`CAMPAIGN_NAME: ${campaign.campaignName}`);
  if (campaign.offerSummary) parts.push(`OFFER_SUMMARY: ${campaign.offerSummary}`);
  if (campaign.cta) parts.push(`CTA: ${campaign.cta}`);
  if (campaign.signature) parts.push(`SIGNATURE: ${campaign.signature}`);
  parts.push(``);
  if (auditExcerpt) {
    parts.push(`AUDIT_EXCERPT (single most useful source -- hook on one observation from this):`);
    parts.push(auditExcerpt);
  } else {
    parts.push(`AUDIT_EXCERPT: (not available -- ground the draft in the company + industry instead)`);
  }
  parts.push(``);
  parts.push(`Now draft the email. Respond ONLY with the JSON object specified.`);
  return parts.join('\n');
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

async function loadLead(auditId: string): Promise<LeadRow | null> {
  const db = getAvDb();
  const [rows] = await db.execute<LeadRow[]>(
    `SELECT id, audit_id, company, contact_name, contact_title, email, industry,
            website, audit_content, challenge, ai_score, ai_score_band, ai_score_reason
       FROM leads
      WHERE audit_id = ? AND archived_at IS NULL
      LIMIT 1`,
    [auditId]
  );
  return rows[0] ?? null;
}

function clampSubject(s: string): string {
  const trimmed = s.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 100) return trimmed;
  return trimmed.slice(0, 97) + '...';
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
