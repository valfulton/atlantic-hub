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
import {
  openaiChatCompletion,
  parseOpenAIJson,
  OpenAIKeyMissingError,
  OpenAIApiError
} from '@/lib/openai/client';
import { logEvent } from '@/lib/events/log';
import { getBriefSeed } from '@/lib/client/brief_store';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const MODEL = 'gpt-4o-mini';
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
}

const SYSTEM_INSTRUCTIONS = `You are a senior B2B sales coach. A sales rep is about to call this prospect, and you produce a tight pain-point profile to coach the call. WHO the rep sells matters: if a "CLIENT OFFER" block is provided, the rep sells THAT client's offer to the prospect -- coach entirely around the client's offer and never mention Atlantic & Vine. If no client offer is provided, the rep sells Atlantic & Vine's marketing services.

Output ALWAYS valid JSON matching this exact shape:
{
  "primary_pain": "<one crisp sentence in plain English>",
  "pain_category": "lead_flow" | "conversion" | "retention" | "brand_trust" | "visibility" | "operational_overwhelm" | "pricing_pressure" | "differentiation" | "other",
  "urgency_signal": "high" | "medium" | "low" | "unknown",
  "decision_maker_proximity": "direct" | "team_member" | "unclear",
  "budget_signal": "strong" | "possible" | "weak" | "unknown",
  "timing_signal": "now" | "this_quarter" | "later" | "unknown",
  "last_objection_seen": "<short text>" | null,
  "conversation_starters": ["<thing the rep can literally say>", "..."],
  "do_not_say": ["<thing the rep should avoid>", "..."]
}

Rules:
- primary_pain is THE problem -- the one a rep would lead the call with. One sentence.
- pain_category: choose the SINGLE closest bucket from the list above to primary_pain. Be consistent -- the same underlying problem must always map to the same bucket (this is how we cluster the pain across prospects). Use "other" only if none fit.
- urgency_signal infers from intake-form language, audit findings, recent activity.
- decision_maker_proximity: "direct" if the contact IS likely the decision maker, "team_member" if they appear to be reporting up, "unclear" otherwise.
- budget_signal infers from business size, industry margins, and audit clues. Default to "unknown" if nothing clear.
- timing_signal: "now" if anything suggests they are looking right now, "this_quarter" if growth/seasonal cycle implies it, "later" if they are clearly stable, "unknown" if no signal.
- last_objection_seen: only populate if reply bodies actually contain an objection. Null otherwise.
- conversation_starters: 1 to 3 concrete sentences the rep can use to open the call. No generic openers. Reference the prospect's business specifically AND frame the opener around the seller's offer (the client's offer when a CLIENT OFFER is provided).
- do_not_say: 0 to 2 things that would torpedo the call (e.g. "don't lead with price", "don't mention competitor X by name").

ASCII only. No em-dashes, no smart quotes. Plural voice (we, our team). Never use the founder's name. No markdown code fences -- JSON only.`;

function buildUserPrompt(lead: LeadRow, briefContext: string | null): string {
  const lines: string[] = [];
  lines.push(`Build a pain-point profile for the following prospect.`);
  lines.push('');
  lines.push(`Company: ${lead.company}`);
  if (lead.industry) lines.push(`Industry: ${lead.industry}`);
  if (lead.contact_name) {
    lines.push(`Primary contact: ${lead.contact_name}${lead.contact_title ? `, ${lead.contact_title}` : ''}`);
  }
  if (briefContext && briefContext.trim()) {
    lines.push('');
    lines.push(briefContext.trim());
  }
  if (lead.challenge) {
    lines.push('');
    lines.push(`Self-reported challenge from intake form:`);
    lines.push(lead.challenge.slice(0, 1200));
  }
  if (lead.audit_content) {
    lines.push('');
    lines.push(`Our call brief / audit on this prospect:`);
    lines.push(lead.audit_content.slice(0, 3500));
  }
  lines.push('');
  lines.push('Return the JSON object only. No code fences. ASCII characters only.');
  return lines.join('\n');
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
  let briefContext: string | null = null;
  try {
    if (lead.client_id != null) {
      const seed = await getBriefSeed('av', lead.client_id);
      if (seed) {
        const parts: string[] = [];
        if (seed.whyAdvertise) parts.push(`Why they sell: ${seed.whyAdvertise}`);
        if (seed.keyMessage) parts.push(`Their key message: ${seed.keyMessage}`);
        if (seed.audience) parts.push(`Who they target: ${seed.audience}`);
        if (seed.differentiators) parts.push(`What sets them apart: ${seed.differentiators}`);
        if (seed.messageSupport) parts.push(`Proof behind it: ${seed.messageSupport}`);
        if (parts.length) {
          briefContext =
            'CLIENT OFFER -- the rep sells THIS client\'s offer to the prospect. Coach the call around it; ' +
            'do not mention Atlantic & Vine:\n- ' + parts.join('\n- ');
        }
      }
    }
  } catch {
    /* non-fatal: profile still extracts without the client offer */
  }

  // Insufficient input -- need either an audit or a challenge to have anything to extract.
  if (!lead.audit_content && !lead.challenge) {
    await logEvent({
      eventType: 'ai.pain_extract_skipped',
      leadId: lead.id,
      source: 'openai',
      status: 'partial',
      payload: { reason: 'no_audit_or_challenge', company: lead.company }
    });
    return null;
  }

  let completion;
  try {
    completion = await openaiChatCompletion(
      [
        { role: 'system', content: SYSTEM_INSTRUCTIONS },
        { role: 'user', content: buildUserPrompt(lead, briefContext) }
      ],
      { json: true, temperature: TEMPERATURE, maxTokens: MAX_TOKENS, model: MODEL }
    );
  } catch (err) {
    if (err instanceof OpenAIKeyMissingError) {
      await logEvent({
        eventType: 'api.openai_error',
        leadId: lead.id,
        source: 'openai',
        status: 'failure',
        errorMessage: 'OPENAI_API_KEY missing during pain extract'
      });
      return null;
    }
    if (err instanceof OpenAIApiError) {
      await logEvent({
        eventType: err.status === 429 ? 'api.rate_limited' : 'api.openai_error',
        leadId: lead.id,
        source: 'openai',
        status: 'failure',
        payload: { route: 'pain_extractor', status_code: err.status },
        errorMessage: err.body.slice(0, 500)
      });
      return null;
    }
    await logEvent({
      eventType: 'ai.pain_extract_failed',
      leadId: lead.id,
      source: 'openai',
      status: 'failure',
      errorMessage: (err as Error).message.slice(0, 500)
    });
    return null;
  }

  const parsed = parseOpenAIJson<Partial<PainPointProfile>>(completion.text);
  if (!parsed || typeof parsed.primary_pain !== 'string' || !parsed.primary_pain.trim()) {
    await logEvent({
      eventType: 'ai.pain_extract_failed',
      leadId: lead.id,
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
      tokens_used: completion.usage.totalTokens
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
