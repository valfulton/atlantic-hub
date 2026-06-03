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
import { parseOpenAIJson } from '@/lib/openai/client';
import { runLlm } from '@/lib/llm/router';
import { logEvent } from '@/lib/events/log';
import { getSystemPrompt } from '@/lib/ai/prompt_registry';
import { getBriefSeed } from '@/lib/client/brief_store';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// (#361) Model decided by TASK_MODEL['outreach_draft'].
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
  /** (#197) Client owner — drives briefContext lookup (their offer + voice). */
  client_id: number | null;
  company: string;
  contact_name: string | null;
  contact_title: string | null;
  email: string;
  industry: string | null;
  website: string | null;
  /** Data-quality flag — placeholder/dead means don't reference the URL in the email. */
  website_status: 'unknown' | 'valid' | 'placeholder' | 'dead' | null;
  /** Geography fields (#180) so openers can ground in local context. */
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal: string | null;
  address_country: string | null;
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

  // Operator-editable system prompt — getSystemPrompt returns the override from
  // ai_prompt_overrides if set, else OUTREACH_DRAFTER_DEFAULT (#80).
  const systemPrompt = await getSystemPrompt('outreach_drafter');
  // (#197) Pull the client's brief (offer / voice / name-drops) when this lead
  // belongs to a client. House leads get null and fall back to the campaign
  // offerSummary that's already part of the prompt.
  const briefContext = await buildOutreachBriefContext(lead.client_id);
  const userPrompt = buildUserPrompt({ lead, campaign: args.campaign, auditExcerpt, briefContext });

  let completion;
  try {
    completion = await runLlm({
      taskKind: 'outreach_draft',
      clientId: lead.client_id ?? null,
      note: `outreach_draft · lead ${lead.id} (${args.campaign.campaignName})`,
      prompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`,
      // Outreach is creative — never cache (TASK_CACHE['outreach_draft']='none' enforces this).
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      json: true
    });
  } catch (err) {
    {
      await logEvent({
        eventType: 'outreach.draft_failed',
        leadId: lead.id,
        source: 'llm_router',
        status: 'failure',
        errorMessage: (err as Error).message,
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
    source: 'llm_router',
    executionTimeMs: Date.now() - started,
    payload: {
      campaign_id: args.campaign.campaignId,
      model: completion.model,
      tokens: completion.inputTokens + completion.outputTokens,
      cost_microcents: completion.costMicrocents,
      cost_source: completion.source,
      grounded_on_audit: groundedOnAudit
    }
  });

  return {
    subject,
    body,
    groundedExcerpt,
    model: completion.model,
    tokensUsed: completion.inputTokens + completion.outputTokens,
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

// System prompt now lives in lib/ai/prompt_registry.ts under the
// 'outreach_drafter' PROMPT_DEF (operator-editable, #80). Live calls below read
// it via getSystemPrompt('outreach_drafter').

function buildUserPrompt(args: {
  lead: LeadRow;
  campaign: OutreachDraftCampaignContext;
  auditExcerpt: string | null;
  /** (#197) Optional CLIENT_OFFER block built from the lead's client brief. */
  briefContext?: string | null;
}): string {
  const { lead, campaign, auditExcerpt, briefContext } = args;
  const parts: string[] = [];
  parts.push(`COMPANY: ${lead.company}`);
  if (lead.industry) parts.push(`INDUSTRY: ${lead.industry}`);
  if (lead.contact_name) parts.push(`CONTACT_NAME: ${lead.contact_name}`);
  if (lead.contact_title) parts.push(`CONTACT_TITLE: ${lead.contact_title}`);

  // (#180/#196) Geography + website status — only emit when present. Never fake.
  const addressParts = [
    lead.address_street,
    lead.address_city,
    lead.address_state,
    lead.address_postal,
    lead.address_country
  ].filter((v): v is string => !!(v && v.trim()));
  if (addressParts.length > 0) {
    parts.push(`ADDRESS: ${addressParts.join(', ')}`);
  }

  if (lead.website) parts.push(`WEBSITE: ${lead.website}`);
  if (lead.website_status && lead.website_status !== 'unknown') {
    parts.push(`WEBSITE_STATUS: ${lead.website_status}`);
  }
  parts.push(``);
  parts.push(`SENDER_DISPLAY_NAME: ${campaign.senderDisplayName}`);
  parts.push(`CAMPAIGN_NAME: ${campaign.campaignName}`);
  if (campaign.offerSummary) parts.push(`OFFER_SUMMARY: ${campaign.offerSummary}`);
  if (campaign.cta) parts.push(`CTA: ${campaign.cta}`);
  if (campaign.signature) parts.push(`SIGNATURE: ${campaign.signature}`);
  // (#197) CLIENT_OFFER block — when the lead belongs to a client, the model
  // sees their offer, voice, key message, and name-drops so the email leads
  // with what THEY sell, not a generic outreach. House leads skip this block.
  if (briefContext && briefContext.trim()) {
    parts.push(``);
    parts.push(briefContext.trim());
  }
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
    `SELECT id, audit_id, client_id, company, contact_name, contact_title, email, industry,
            website, website_status,
            address_street, address_city, address_state, address_postal, address_country,
            audit_content, challenge, ai_score, ai_score_band, ai_score_reason
       FROM leads
      WHERE audit_id = ? AND archived_at IS NULL
      LIMIT 1`,
    [auditId]
  );
  return rows[0] ?? null;
}

/**
 * (#197) Build the CLIENT_OFFER block for outreach grounding.
 *
 * Mirrors buildBriefContextForLens in score_and_audit.ts: when the lead is
 * attached to a client, pull THAT client's intake-derived brief so the cold
 * email leads with what the client actually sells (their offer, voice,
 * key message, name-drops). House leads (client_id IS NULL) return null and
 * fall back to the campaign offerSummary that's already in the prompt.
 *
 * Non-fatal: any error returns null and the draft still runs ungrounded.
 */
async function buildOutreachBriefContext(clientId: number | null): Promise<string | null> {
  if (!clientId) return null;
  try {
    const seed = await getBriefSeed('av', clientId);
    if (!seed) return null;
    const parts: string[] = [];
    if (seed.businessDescription) parts.push(`What they sell: ${seed.businessDescription}`);
    if (seed.slogan) parts.push(`Tagline: ${seed.slogan}`);
    if (seed.keyMessage) parts.push(`Their single key message: ${seed.keyMessage}`);
    if (seed.differentiators) parts.push(`What makes them different: ${seed.differentiators}`);
    if (seed.audience) parts.push(`Who they target: ${seed.audience}`);
    if (seed.messageSupport) parts.push(`Proof behind it: ${seed.messageSupport}`);
    if (seed.notableClients) parts.push(`Names they can drop: ${seed.notableClients}`);
    if (seed.brandVoice) parts.push(`Brand voice: ${seed.brandVoice}`);
    if (!parts.length) return null;
    return (
      'CLIENT OFFER -- the prospect is a SALES TARGET for our client. Write the email ' +
      'from the client\'s vantage (we are reaching out on their behalf). Lean on the lines below ' +
      'when choosing the specific observation, the hook, and any name-drop. Do not mention ' +
      'Atlantic & Vine. The client\'s offer in their own words:\n- ' + parts.join('\n- ')
    );
  } catch {
    return null;
  }
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
