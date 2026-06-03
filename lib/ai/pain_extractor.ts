/**
 * lib/ai/pain_extractor.ts
 *
 * Daily AI sweep that extracts a structured pain_point_profile per lead.
 * Reads everything we know about the lead (audit_content, challenge,
 * recent reply bodies) and produces a tight JSON profile the sales team
 * uses as their "what to say on the call" cheat sheet.
 *
 * Profile shape (stored in leads.pain_point_profile JSON column):
 *   {
 *     primary_pain:              "1-line crisp description of THE problem",
 *     urgency_signal:            "high" | "medium" | "low" | "unknown",
 *     decision_maker_proximity:  "direct" | "team_member" | "unclear",
 *     budget_signal:             "strong" | "possible" | "weak" | "unknown",
 *     timing_signal:             "now" | "this_quarter" | "later" | "unknown",
 *     last_objection_seen:       short text or null,
 *     conversation_starters:     array of 1-3 strings the rep can say,
 *     do_not_say:                array of 0-2 strings to avoid,
 *     extracted_at:              ISO timestamp
 *   }
 *
 * Cost: ~$0.003 per lead at gpt-4o-mini (~600 token completion).
 * Runs daily on stale or never-extracted leads only.
 */

import { getAvDb } from '@/lib/db/av';
import { parseOpenAIJson } from '@/lib/llm/parse';
import { runLlm } from '@/lib/llm/router';
import { attributionForCompany } from '@/lib/public_intel/attribution';
import { logEvent } from '@/lib/events/log';
import { getSystemPrompt } from '@/lib/ai/prompt_registry';
import { getBriefSeed } from '@/lib/client/brief_store';
import {
  saveLeadAudit,
  lensForClient,
  getLeadAudit,
  parseLens,
  tenantOfferDescription
} from '@/lib/ai/lead_audits';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// (#361) Model decided by TASK_MODEL['pain_extract'].
const TEMPERATURE = 0.3; // low for consistency across runs
const MAX_TOKENS = 800;
const STALE_DAYS = 14;

export type UrgencySignal = 'high' | 'medium' | 'low' | 'unknown';
export type DmProximity = 'direct' | 'team_member' | 'unclear';
export type BudgetSignal = 'strong' | 'possible' | 'weak' | 'unknown';
export type TimingSignal = 'now' | 'this_quarter' | 'later' | 'unknown';

/**
 * Fixed pain buckets. The extractor maps each lead's primary_pain to ONE of
 * these so similar pains cluster across clients (discovery groups on
 * industry + pain_category). Keep this list STABLE -- it is the cluster key.
 */
export const PAIN_CATEGORIES = [
  'lead_flow',
  'conversion',
  'retention',
  'brand_trust',
  'visibility',
  'operational_overwhelm',
  'pricing_pressure',
  'differentiation',
  'other'
] as const;
export type PainCategory = (typeof PAIN_CATEGORIES)[number];

export interface PainPointProfile {
  primary_pain: string;
  pain_category: PainCategory;
  urgency_signal: UrgencySignal;
  decision_maker_proximity: DmProximity;
  budget_signal: BudgetSignal;
  timing_signal: TimingSignal;
  last_objection_seen: string | null;
  conversation_starters: string[];
  do_not_say: string[];
  extracted_at: string;
}

interface LeadRow extends RowDataPacket {
  id: number;
  company: string;
  industry: string | null;
  contact_name: string | null;
  contact_title: string | null;
  challenge: string | null;
  audit_content: string | null;
  pain_extracted_at: string | null;
  client_id: number | null;
  /** Geography surfaced by #180. */
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal: string | null;
  address_country: string | null;
  /** Website data quality flag (#180/#195). */
  website: string | null;
  website_status: 'unknown' | 'valid' | 'placeholder' | 'dead' | null;
}

// System prompt now lives in lib/ai/prompt_registry.ts under the
// 'pain_extractor' PROMPT_DEF (operator-editable, #80). Live calls below read
// it via getSystemPrompt('pain_extractor').

interface PainPromptInput {
  company: string;
  industry: string | null;
  contact_name: string | null;
  contact_title: string | null;
  challenge: string | null;
  auditContent: string | null;
  /** (#361) Client scope for cost accounting in llm_call_log. NULL = operator-wide. */
  clientId?: number | null;
  /** Geography (#180) — model can ground urgency + opener in local context. */
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_postal?: string | null;
  address_country?: string | null;
  /** Website + its data-quality flag — placeholder/dead lowers reachability. */
  website?: string | null;
  website_status?: 'unknown' | 'valid' | 'placeholder' | 'dead' | null;
}

function buildUserPrompt(input: PainPromptInput, briefContext: string | null, cascadeAttributionLine?: string | null): string {
  const lines: string[] = [];
  lines.push(`Build a pain-point profile for the following prospect.`);
  lines.push('');
  lines.push(`Company: ${input.company}`);
  if (input.industry) lines.push(`Industry: ${input.industry}`);

  // (#180/#196) Geography — only emit when present. Never fabricate.
  const addressParts = [
    input.address_street,
    input.address_city,
    input.address_state,
    input.address_postal,
    input.address_country
  ].filter((v): v is string => !!(v && v.trim()));
  if (addressParts.length > 0) {
    lines.push(`Address: ${addressParts.join(', ')}`);
  }

  if (input.website) {
    lines.push(`Website: ${input.website}`);
    if (input.website_status && input.website_status !== 'unknown') {
      lines.push(`Website status: ${input.website_status}`);
    }
  }

  if (input.contact_name) {
    lines.push(`Primary contact: ${input.contact_name}${input.contact_title ? `, ${input.contact_title}` : ''}`);
  }
  if (briefContext && briefContext.trim()) {
    lines.push('');
    lines.push(briefContext.trim());
  }
  // (#375) Cascade attribution — when this prospect surfaced via the
  // Revenue Distress Intelligence Engine, the call-script generator gets
  // the trigger as a "conversation_starter" suggestion. The model uses it
  // to give the rep a specific, timely opener.
  if (cascadeAttributionLine) {
    lines.push('');
    lines.push(`Atlantic Hub Revenue Distress Intelligence: ${cascadeAttributionLine}`);
    lines.push(`(Use this as the basis for ONE conversation_starter that names the underlying signal in plain language without naming the data source.)`);
  }
  if (input.challenge) {
    lines.push('');
    lines.push(`Self-reported challenge from intake form:`);
    lines.push(input.challenge.slice(0, 1200));
  }
  if (input.auditContent) {
    lines.push('');
    lines.push(`Our call brief / audit on this prospect:`);
    lines.push(input.auditContent.slice(0, 3500));
  }
  lines.push('');
  lines.push('Return the JSON object only. No code fences. ASCII characters only.');
  return lines.join('\n');
}

/**
 * Build the "who is selling" coaching block for a SELLER lens, so the call
 * script is coached from that seller's vantage:
 *   - client:<id> -> that client's brief/intake answers
 *   - 'ebw'/'hh'  -> that tenant brand's offer description
 *   - 'av'        -> null (rep sells Atlantic & Vine's marketing services)
 * Non-fatal: returns null on any error.
 */
async function buildPainBriefContextForLens(lens: string): Promise<string | null> {
  try {
    const parsed = parseLens(lens);
    if (parsed.kind === 'client') {
      const seed = await getBriefSeed('av', parsed.clientId);
      if (!seed) return null;
      const parts: string[] = [];
      // (#197) Plain-language identity first so the rep's opener is grounded.
      if (seed.businessDescription) parts.push(`What they sell: ${seed.businessDescription}`);
      if (seed.slogan) parts.push(`Their tagline: ${seed.slogan}`);
      if (seed.whyAdvertise) parts.push(`Why they sell: ${seed.whyAdvertise}`);
      if (seed.keyMessage) parts.push(`Their key message: ${seed.keyMessage}`);
      if (seed.audience) parts.push(`Who they target: ${seed.audience}`);
      if (seed.differentiators) parts.push(`What sets them apart: ${seed.differentiators}`);
      if (seed.messageSupport) parts.push(`Proof behind it: ${seed.messageSupport}`);
      // (#197) Name-drops the rep can use mid-call.
      if (seed.notableClients) parts.push(`Names they can drop: ${seed.notableClients}`);
      // (#198) What they're already running for lead-gen -- the rep should
      // know what the prospect is comparing against ("already on LinkedIn ads",
      // "referrals only", etc.) so the call doesn't fight the wrong objection.
      if (seed.currentLeadgen) parts.push(`What they're already running for lead-gen: ${seed.currentLeadgen}`);
      // (#199) Expertise the client can speak to as an authority -- gives the
      // rep a natural "by the way, you wrote about X recently" opener that
      // sidesteps pitch energy and starts the conversation in their domain.
      if (seed.prExpertTopics) parts.push(`Topics they can speak to as an authority: ${seed.prExpertTopics}`);
      if (!parts.length) return null;
      return (
        'CLIENT OFFER -- the rep sells THIS client\'s offer to the prospect. Coach the call around it; ' +
        'do not mention Atlantic & Vine:\n- ' + parts.join('\n- ')
      );
    }
    if (parsed.kind === 'tenant') {
      const offer = tenantOfferDescription(parsed.tenant);
      if (!offer) return null; // 'av' -> rep sells Atlantic & Vine's own services
      const name = parsed.tenant === 'ebw' ? 'Events by Water' : 'Hunter Honey';
      return (
        `CLIENT OFFER -- the rep sells ${name}'s offer to the prospect. Coach the call around it; ` +
        `do not mention Atlantic & Vine:\n- ${offer}`
      );
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Pure generation: run the OpenAI pain-profile call for a prospect and return
 * the sanitized profile + tokens used, or null on insufficient input / API
 * error / malformed JSON (each logged to system_events). Persists NOTHING.
 */
async function generatePainProfile(
  leadId: number,
  input: PainPromptInput,
  briefContext: string | null
): Promise<{ profile: PainPointProfile; tokensUsed: number } | null> {
  if (!input.auditContent && !input.challenge) {
    await logEvent({
      eventType: 'ai.pain_extract_skipped',
      leadId,
      source: 'openai',
      status: 'partial',
      payload: { reason: 'no_audit_or_challenge', company: input.company }
    });
    return null;
  }

  // Operator-editable system prompt: getSystemPrompt returns the override from
  // ai_prompt_overrides if set, else PAIN_EXTRACTOR_DEFAULT (#80, #196).
  const systemPrompt = await getSystemPrompt('pain_extractor');

  // (#375) Fetch cascade attribution for this prospect if the client has
  // the Revenue Distress Intelligence Engine running. Soft-fails to null.
  let cascadeLine: string | null = null;
  if (input.clientId) {
    const att = await attributionForCompany(input.clientId, input.company);
    if (att) cascadeLine = att.promptLine;
  }

  let completion;
  try {
    const userPrompt = buildUserPrompt(input, briefContext, cascadeLine);
    completion = await runLlm({
      taskKind: 'pain_extract',
      clientId: input.clientId ?? null,
      note: `pain_extract · lead ${leadId}`,
      prompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`,
      cacheKeyExtras: [String(leadId), systemPrompt.slice(0, 200)],
      json: true,
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS
    });
  } catch (err) {
    await logEvent({
      eventType: 'ai.pain_extract_failed',
      leadId,
      source: 'llm_router',
      status: 'failure',
      errorMessage: (err as Error).message.slice(0, 500)
    });
    return null;
  }

  const parsed = parseOpenAIJson<Partial<PainPointProfile>>(completion.text);
  if (!parsed || typeof parsed.primary_pain !== 'string' || !parsed.primary_pain.trim()) {
    await logEvent({
      eventType: 'ai.pain_extract_failed',
      leadId,
      source: 'openai',
      status: 'failure',
      payload: { raw_first_300: completion.text.slice(0, 300) },
      errorMessage: 'malformed JSON from openai pain extractor'
    });
    return null;
  }

  const profile: PainPointProfile = {
    primary_pain: parsed.primary_pain.slice(0, 600),
    pain_category: sanitizeCategory(parsed.pain_category),
    urgency_signal: sanitizeUrgency(parsed.urgency_signal),
    decision_maker_proximity: sanitizeProximity(parsed.decision_maker_proximity),
    budget_signal: sanitizeBudget(parsed.budget_signal),
    timing_signal: sanitizeTiming(parsed.timing_signal),
    last_objection_seen: typeof parsed.last_objection_seen === 'string'
      ? parsed.last_objection_seen.slice(0, 400)
      : null,
    conversation_starters: Array.isArray(parsed.conversation_starters)
      ? parsed.conversation_starters
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          .slice(0, 3)
          .map((s) => s.slice(0, 320))
      : [],
    do_not_say: Array.isArray(parsed.do_not_say)
      ? parsed.do_not_say
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          .slice(0, 2)
          .map((s) => s.slice(0, 240))
      : [],
    extracted_at: new Date().toISOString()
  };

  return { profile, tokensUsed: completion.inputTokens + completion.outputTokens };
}

/**
 * Extract the pain profile for one lead. Updates leads row. Returns the
 * parsed profile on success, null on insufficient-data or error.
 */
export async function extractPainProfileForLead(leadId: number): Promise<PainPointProfile | null> {
  const start = Date.now();
  const db = getAvDb();

  const [rows] = await db.execute<LeadRow[]>(
    `SELECT id, company, industry, contact_name, contact_title,
            website, website_status,
            address_street, address_city, address_state, address_postal, address_country,
            challenge, audit_content, pain_extracted_at, client_id
       FROM leads
      WHERE id = ?
        AND archived_at IS NULL
      LIMIT 1`,
    [leadId]
  );
  if (rows.length === 0) return null;
  const lead = rows[0];

  // When the lead belongs to a CLIENT, the rep sells THAT client's offer -- coach
  // the call around it (not Atlantic & Vine's services). Non-fatal if unavailable.
  const briefContext = await buildPainBriefContextForLens(lensForClient(lead.client_id));

  const gen = await generatePainProfile(
    lead.id,
    {
      company: lead.company,
      industry: lead.industry,
      contact_name: lead.contact_name,
      contact_title: lead.contact_title,
      challenge: lead.challenge,
      auditContent: lead.audit_content,
      address_street: lead.address_street,
      address_city: lead.address_city,
      address_state: lead.address_state,
      address_postal: lead.address_postal,
      address_country: lead.address_country,
      website: lead.website,
      website_status: lead.website_status
    },
    briefContext
  );
  if (!gen) return null; // insufficient input / failure already logged
  const { profile } = gen;

  try {
    await db.execute<ResultSetHeader>(
      `UPDATE leads
          SET pain_point_profile = ?,
              pain_extracted_at = NOW()
        WHERE id = ?`,
      [JSON.stringify(profile), lead.id]
    );
  } catch (err) {
    await logEvent({
      eventType: 'ai.pain_extract_failed',
      leadId: lead.id,
      source: 'openai',
      status: 'failure',
      errorMessage: `db update failed: ${(err as Error).message.slice(0, 400)}`
    });
    return null;
  }

  // Mirror into the per-lens store (multi-lens, no-drift): the call script is
  // preserved under this lead's seller lens, never clobbering another lens.
  await saveLeadAudit({
    leadId: lead.id,
    lens: lensForClient(lead.client_id),
    painPointProfile: profile
  }).catch(() => {});

  const elapsedMs = Date.now() - start;
  await logEvent({
    eventType: 'ai.pain_extracted',
    leadId: lead.id,
    source: 'openai',
    status: 'success',
    payload: {
      company: lead.company,
      primary_pain_preview: profile.primary_pain.slice(0, 100),
      urgency: profile.urgency_signal,
      timing: profile.timing_signal,
      starter_count: profile.conversation_starters.length,
      tokens_used: gen.tokensUsed
    },
    executionTimeMs: elapsedMs
  });

  return profile;
}

/**
 * Build the call script (pain profile) for a lead under an EXPLICIT seller lens
 * and persist it ONLY to that lens's row — never the leads.pain_point_profile
 * column (the owner's current view). Coaches the call from that lens's offer
 * and reads that lens's audit content (passed in, or looked up). Used by the
 * "generate the EBW / A&V pitch for this lead" path so a generated lens carries
 * both an audit and a matching call script.
 */
export async function extractPainProfileForLeadLens(
  leadId: number,
  targetLens: string,
  auditContentOverride?: string | null
): Promise<PainPointProfile | null> {
  const start = Date.now();
  const db = getAvDb();

  const [rows] = await db.execute<LeadRow[]>(
    `SELECT id, company, industry, contact_name, contact_title,
            website, website_status,
            address_street, address_city, address_state, address_postal, address_country,
            challenge, audit_content, pain_extracted_at, client_id
       FROM leads
      WHERE id = ?
        AND archived_at IS NULL
      LIMIT 1`,
    [leadId]
  );
  if (rows.length === 0) return null;
  const lead = rows[0];

  // Use the lens's own audit (the one we just generated), not the owner column.
  let auditContent = auditContentOverride ?? null;
  if (auditContent == null) {
    const lensAudit = await getLeadAudit(leadId, targetLens).catch(() => null);
    auditContent = lensAudit?.auditContent ?? null;
  }

  const briefContext = await buildPainBriefContextForLens(targetLens);

  const gen = await generatePainProfile(
    lead.id,
    {
      company: lead.company,
      industry: lead.industry,
      contact_name: lead.contact_name,
      contact_title: lead.contact_title,
      challenge: lead.challenge,
      auditContent
    },
    briefContext
  );
  if (!gen) return null;
  const { profile } = gen;

  // No-drift: write ONLY this lens's row. leads.pain_point_profile is untouched.
  await saveLeadAudit({
    leadId: lead.id,
    lens: targetLens,
    painPointProfile: profile
  }).catch(() => {});

  const elapsedMs = Date.now() - start;
  await logEvent({
    eventType: 'ai.pain_extracted',
    leadId: lead.id,
    source: 'openai',
    status: 'success',
    payload: {
      lens: targetLens,
      company: lead.company,
      primary_pain_preview: profile.primary_pain.slice(0, 100),
      tokens_used: gen.tokensUsed
    },
    executionTimeMs: elapsedMs
  });

  return profile;
}

/**
 * Pick leads needing pain extraction: never extracted OR last extracted
 * more than STALE_DAYS ago. Bounded by limit. Skips archived leads and
 * leads with no audit + no challenge (nothing to extract).
 */
export async function pickPainCandidates(limit: number): Promise<number[]> {
  const db = getAvDb();
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const [rows] = await db.query<(RowDataPacket & { id: number })[]>(
    `SELECT id
       FROM leads
      WHERE archived_at IS NULL
        AND (audit_content IS NOT NULL OR challenge IS NOT NULL)
        AND (
          pain_extracted_at IS NULL
          OR pain_extracted_at < DATE_SUB(NOW(), INTERVAL ${STALE_DAYS} DAY)
          OR JSON_EXTRACT(pain_point_profile, '$.pain_category') IS NULL
        )
      ORDER BY ai_combined_score DESC, id ASC
      LIMIT ${safeLimit}`
  );
  return rows.map((r) => r.id);
}

function sanitizeUrgency(v: unknown): UrgencySignal {
  return v === 'high' || v === 'medium' || v === 'low' || v === 'unknown' ? v : 'unknown';
}
function sanitizeProximity(v: unknown): DmProximity {
  return v === 'direct' || v === 'team_member' || v === 'unclear' ? v : 'unclear';
}
function sanitizeBudget(v: unknown): BudgetSignal {
  return v === 'strong' || v === 'possible' || v === 'weak' || v === 'unknown' ? v : 'unknown';
}
function sanitizeTiming(v: unknown): TimingSignal {
  return v === 'now' || v === 'this_quarter' || v === 'later' || v === 'unknown' ? v : 'unknown';
}
function sanitizeCategory(v: unknown): PainCategory {
  return typeof v === 'string' && (PAIN_CATEGORIES as readonly string[]).includes(v) ? (v as PainCategory) : 'other';
}
