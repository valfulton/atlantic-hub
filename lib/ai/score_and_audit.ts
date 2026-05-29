/**
 * lib/ai/score_and_audit.ts
 *
 * Score one lead and generate its Strategic Marketing Audit in a single
 * OpenAI call. Writes the result back to shhdbite_AV.leads and logs two
 * events to system_events.
 *
 * Used by:
 *   - Fire-and-forget hook on every new lead insert (Apollo / Places /
 *     Instagram / CSV / scrape). The discovery response returns
 *     immediately; this runs in the background until the Netlify function
 *     promise settles.
 *   - POST /api/admin/av/leads/[audit_id]/score (owner Re-score button)
 *   - netlify/functions/score-cron.mts (daily 07:00 UTC sweep for leads
 *     where ai_last_scored_at IS NULL)
 *
 * Cost: ~$0.005-0.015 per call (gpt-4o-mini at ~1500-token completion).
 *
 * NOTE: This is a parallel TypeScript path. The existing PHP audit-form
 * pipeline on api.atlanticandvine.com still owns the audit-form-driven
 * scoring path -- we do not touch it. We only score leads inserted
 * through every OTHER source.
 */

import { getAvDb } from '@/lib/db/av';
import { recomputeCombinedForLead } from '@/lib/ai/engagement_score';
import {
  openaiChatCompletion,
  parseOpenAIJson,
  OpenAIKeyMissingError,
  OpenAIApiError
} from '@/lib/openai/client';
import { logEvent } from '@/lib/events/log';
import { getBriefSeed } from '@/lib/client/brief_store';
import { extractPainProfileForLead, extractPainProfileForLeadLens } from '@/lib/ai/pain_extractor';
import {
  saveLeadAudit,
  lensForClient,
  parseLens,
  isValidLens,
  tenantOfferDescription
} from '@/lib/ai/lead_audits';
import { getSystemPrompt } from '@/lib/ai/prompt_registry';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const MODEL = 'gpt-4o-mini';
const TEMPERATURE = 0.4; // low for scoring consistency
const MAX_TOKENS = 1500;

export type ScoreBand = 'hot' | 'warm' | 'cool';

export interface ScoreBreakdown {
  fit: number;
  intent: number;
  reachability: number;
  icp_match: number;
}

export interface ScoreAndAuditResult {
  aiScore: number | null;
  aiScoreBand: ScoreBand | null;
  aiScoreReason: string | null;
  aiScoreBreakdown: ScoreBreakdown | null;
  auditContent: string | null;
  auditGenerated: string | null;
  modelVersion: string;
  tokensUsed: number;
  skipped: boolean;
  skipReason?: string;
}

interface LeadRow extends RowDataPacket {
  id: number;
  audit_id: string;
  company: string;
  contact_name: string | null;
  contact_title: string | null;
  email: string;
  phone: string | null;
  website: string | null;
  /** Data-quality flag on the website (#180/#195). */
  website_status: 'unknown' | 'valid' | 'placeholder' | 'dead' | null;
  industry: string | null;
  /** Address fields surfaced by #180 backfill / future enrichment. */
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal: string | null;
  address_country: string | null;
  target_business: 'av' | 'ebw' | 'both';
  source_type: string;
  challenge: string | null;
  client_id: number | null;
}

interface AiScorePayload {
  ai_score: number;
  ai_score_band: ScoreBand;
  ai_score_reason: string;
  ai_score_breakdown: ScoreBreakdown;
  audit_content: string;
}

/**
 * Quick heuristic: does this lead have enough data to score meaningfully?
 * Returns true if at least one of these is present:
 *   - A real (non-placeholder) email
 *   - A website
 *   - A named industry
 */
function hasMinimumData(lead: LeadRow): boolean {
  const placeholderEmail =
    !lead.email ||
    /^(prospect|apollo|noemail)\+/i.test(lead.email) ||
    lead.email === 'info@eventsbywater.com';
  const hasRealEmail = !placeholderEmail;
  const hasWebsite = !!(lead.website && lead.website.trim());
  const hasIndustry = !!(lead.industry && lead.industry.trim());
  return hasRealEmail || hasWebsite || hasIndustry;
}

// The audit system prompt now lives in the editable prompt registry under the key
// 'av_lead_audit' (lib/ai/prompt_registry.ts) so val can view/tune it without a
// deploy. It's read at call time via getSystemPrompt('av_lead_audit').

function buildUserPrompt(lead: LeadRow, briefContext?: string | null): string {
  const lines: string[] = [];
  lines.push(`Score and audit the following prospective business.`);
  lines.push('');
  lines.push(`Company: ${lead.company}`);
  if (lead.industry) lines.push(`Industry: ${lead.industry}`);

  // (#180/#196) Geography — consider regional/market context where it matters.
  // Skip when empty; never fabricate a location when none is known.
  const addressParts = [
    lead.address_street,
    lead.address_city,
    lead.address_state,
    lead.address_postal,
    lead.address_country
  ].filter((v): v is string => !!(v && v.trim()));
  if (addressParts.length > 0) {
    lines.push(`Address: ${addressParts.join(', ')}`);
  }

  if (lead.website) {
    lines.push(`Website: ${lead.website}`);
    // Pass the data-quality signal so the model can downweight fake URLs in
    // its reachability + intent reasoning (#195).
    if (lead.website_status && lead.website_status !== 'unknown') {
      lines.push(`Website status: ${lead.website_status}`);
    }
  }

  if (lead.email && !/^(prospect|apollo|noemail)\+/i.test(lead.email)) {
    lines.push(`Email: ${lead.email}`);
  }
  if (lead.phone) lines.push(`Phone: ${lead.phone}`);
  if (lead.contact_name) {
    lines.push(`Primary contact: ${lead.contact_name}${lead.contact_title ? `, ${lead.contact_title}` : ''}`);
  }
  if (lead.target_business) lines.push(`Target pipeline: ${lead.target_business}`);
  if (lead.source_type) lines.push(`Discovery source: ${lead.source_type}`);
  if (lead.challenge) {
    lines.push('');
    lines.push(`Self-reported challenge from intake form: ${lead.challenge}`);
  }
  if (briefContext && briefContext.trim()) {
    lines.push('');
    lines.push(briefContext.trim());
  }
  lines.push('');
  lines.push('Return the JSON object only. No code fences. ASCII characters only.');
  return lines.join('\n');
}

/**
 * Build the "who is selling" offer block for a given SELLER lens. This is what
 * makes the audit speak from one seller's vantage:
 *   - client:<id>  -> ground in THAT client's brief/intake answers (call brief for their rep)
 *   - 'ebw'/'hh'   -> ground in that tenant brand's offer description
 *   - 'av'         -> null (Atlantic & Vine's own marketing-audit branch; no offer block)
 * Non-fatal: returns null on any error so the audit still runs ungrounded.
 */
async function buildBriefContextForLens(lens: string): Promise<string | null> {
  try {
    const parsed = parseLens(lens);
    if (parsed.kind === 'client') {
      const seed = await getBriefSeed('av', parsed.clientId);
      if (!seed) return null;
      const parts: string[] = [];
      // (#197) Plain-language identity anchors the prompt before positioning.
      if (seed.businessDescription) parts.push(`What they do: ${seed.businessDescription}`);
      if (seed.slogan) parts.push(`Their tagline: ${seed.slogan}`);
      if (seed.whyAdvertise) parts.push(`Why they advertise: ${seed.whyAdvertise}`);
      if (seed.goals) parts.push(`Their 90-day goals: ${seed.goals}`);
      if (seed.audience) parts.push(`Their target audience: ${seed.audience}`);
      if (seed.audienceInsights) parts.push(`What they know about that audience: ${seed.audienceInsights}`);
      if (seed.keyMessage) parts.push(`Their single key message: ${seed.keyMessage}`);
      if (seed.messageSupport) parts.push(`Proof behind it: ${seed.messageSupport}`);
      if (seed.differentiators) parts.push(`What makes them different: ${seed.differentiators}`);
      if (seed.brandVoice) parts.push(`Brand voice: ${seed.brandVoice}`);
      if (seed.competitors) parts.push(`Competitors they named: ${seed.competitors}`);
      // (#197) "Names we drop" is a credibility hook the audit can lean on.
      if (seed.notableClients) parts.push(`Notable clients / names they drop: ${seed.notableClients}`);
      if (!parts.length) return null;
      return (
        'CLIENT OFFER -- this prospect is a SALES TARGET for our client, who sells the following. ' +
        'Score and brief from THIS client\'s selling vantage (a call brief for their rep, not a marketing audit ' +
        'of the prospect). Do not mention Atlantic & Vine. The client\'s offer in their own words:\n- ' +
        parts.join('\n- ')
      );
    }
    if (parsed.kind === 'tenant') {
      const offer = tenantOfferDescription(parsed.tenant);
      if (!offer) return null; // 'av' -> default marketing-audit branch
      const name = parsed.tenant === 'ebw' ? 'Events by Water' : 'Hunter Honey';
      return (
        `SELLER OFFER -- this prospect is a SALES TARGET for ${name}, which sells the following. ` +
        `Score and brief from ${name}'s selling vantage (a call brief for their rep, not a marketing ` +
        `audit of the prospect). Do not mention Atlantic & Vine. The offer:\n- ${offer}`
      );
    }
    return null;
  } catch {
    return null;
  }
}

interface AuditPayload {
  aiScore: number;
  aiScoreBand: ScoreBand;
  aiScoreReason: string | null;
  aiScoreBreakdown: ScoreBreakdown;
  auditContent: string | null;
  rawJson: string;
  model: string;
  tokensUsed: number;
}

/**
 * Run the OpenAI audit+score call for a lead under a given offer context and
 * return the sanitized payload, or null on key-missing / API error / malformed
 * JSON (each logged to system_events). Pure generation: persists NOTHING. The
 * caller decides whether to write the leads columns, a lens row, or both.
 */
async function generateAuditPayload(lead: LeadRow, briefContext: string | null): Promise<AuditPayload | null> {
  const systemPrompt = await getSystemPrompt('av_lead_audit');

  let completion;
  try {
    completion = await openaiChatCompletion(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildUserPrompt(lead, briefContext) }
      ],
      { json: true, temperature: TEMPERATURE, maxTokens: MAX_TOKENS, model: MODEL }
    );
  } catch (err) {
    const errMsg = (err as Error).message;
    if (err instanceof OpenAIKeyMissingError) {
      await logEvent({
        eventType: 'api.openai_error',
        leadId: lead.id,
        source: 'openai',
        status: 'failure',
        errorMessage: 'OPENAI_API_KEY missing'
      });
      return null;
    }
    if (err instanceof OpenAIApiError) {
      await logEvent({
        eventType: 'api.openai_error',
        leadId: lead.id,
        source: 'openai',
        status: 'failure',
        payload: { status_code: err.status },
        errorMessage: err.body.slice(0, 500)
      });
      return null;
    }
    await logEvent({
      eventType: 'ai.score_failed',
      leadId: lead.id,
      source: 'openai',
      status: 'failure',
      errorMessage: errMsg.slice(0, 500)
    });
    return null;
  }

  const parsed = parseOpenAIJson<AiScorePayload>(completion.text);
  if (!parsed || typeof parsed.ai_score !== 'number' || !parsed.ai_score_band) {
    await logEvent({
      eventType: 'ai.score_failed',
      leadId: lead.id,
      source: 'openai',
      status: 'failure',
      payload: {
        raw_first_300: completion.text.slice(0, 300),
        tokens_used: completion.usage.totalTokens
      },
      errorMessage: 'malformed JSON from openai'
    });
    return null;
  }

  let aiScore = Math.max(0, Math.min(100, Math.round(parsed.ai_score)));
  let aiScoreReason = typeof parsed.ai_score_reason === 'string' ? parsed.ai_score_reason.slice(0, 2000) : null;
  const aiScoreBreakdown: ScoreBreakdown = {
    fit: clamp01(parsed.ai_score_breakdown?.fit),
    intent: clamp01(parsed.ai_score_breakdown?.intent),
    reachability: clamp01(parsed.ai_score_breakdown?.reachability),
    icp_match: clamp01(parsed.ai_score_breakdown?.icp_match)
  };

  // (#195) Website-status floor / cap. The LLM is instructed in the prompt to
  // downweight placeholder/dead URLs, but we ALSO apply a deterministic cap in
  // code so a fake-URL lead can never silently score hot — regardless of what
  // the model returned.
  //   placeholder -> ai_score capped at 60, intent <= 30, reachability <= 25
  //   dead        -> ai_score capped at 45, intent <= 20, reachability <= 15
  // Both append a one-line reason note so val can see why the cap fired.
  if (lead.website_status === 'placeholder' || lead.website_status === 'dead') {
    const cap = lead.website_status === 'dead' ? 45 : 60;
    const intentCap = lead.website_status === 'dead' ? 20 : 30;
    const reachCap = lead.website_status === 'dead' ? 15 : 25;
    if (aiScore > cap) aiScore = cap;
    if (aiScoreBreakdown.intent > intentCap) aiScoreBreakdown.intent = intentCap;
    if (aiScoreBreakdown.reachability > reachCap) aiScoreBreakdown.reachability = reachCap;
    const note = lead.website_status === 'dead'
      ? '(Website is unreachable — reachability + intent capped, score floored at warm/cool boundary.)'
      : '(Website is a synthetic placeholder — reachability + intent capped, score capped at warm.)';
    aiScoreReason = aiScoreReason ? `${aiScoreReason} ${note}` : note;
  }

  // Band is computed AFTER the website-status cap so a capped score never sits
  // in the wrong band.
  const aiScoreBand: ScoreBand =
    aiScore >= 75 ? 'hot' : aiScore >= 50 ? 'warm' : 'cool';

  const auditContent = typeof parsed.audit_content === 'string' ? parsed.audit_content : null;

  return {
    aiScore,
    aiScoreBand,
    aiScoreReason,
    aiScoreBreakdown,
    auditContent,
    rawJson: JSON.stringify(parsed),
    model: completion.model || MODEL,
    tokensUsed: completion.usage.totalTokens
  };
}

/**
 * Score and audit one lead. Updates the leads row and emits two
 * system_events rows.
 *
 * Returns null if the lead does not exist, is archived, or has insufficient
 * data to score. Returns a result object on success or partial failure
 * (skipped=true with skipReason set).
 */
export async function scoreAndAuditLead(leadId: number): Promise<ScoreAndAuditResult | null> {
  const start = Date.now();
  const db = getAvDb();

  const [rows] = await db.execute<LeadRow[]>(
    `SELECT id, audit_id, company, contact_name, contact_title, email, phone, website,
            website_status,
            address_street, address_city, address_state, address_postal, address_country,
            industry, target_business, source_type, challenge, client_id
       FROM leads
      WHERE id = ?
        AND archived_at IS NULL
      LIMIT 1`,
    [leadId]
  );

  if (rows.length === 0) {
    await logEvent({
      eventType: 'ai.score_failed',
      leadId,
      source: 'openai',
      status: 'failure',
      errorMessage: 'lead not found or archived'
    });
    return null;
  }

  const lead = rows[0];

  if (!hasMinimumData(lead)) {
    await logEvent({
      eventType: 'ai.score_failed',
      leadId: lead.id,
      source: 'openai',
      status: 'partial',
      payload: { skipReason: 'insufficient_data', company: lead.company },
      errorMessage: 'insufficient data (no real email, no website, no industry)'
    });
    return {
      aiScore: null,
      aiScoreBand: null,
      aiScoreReason: null,
      aiScoreBreakdown: null,
      auditContent: null,
      auditGenerated: null,
      modelVersion: MODEL,
      tokensUsed: 0,
      skipped: true,
      skipReason: 'insufficient_data'
    };
  }

  // If this lead BELONGS TO a client account, ground the audit in that client's
  // OWN brief/intake answers (call brief for their rep). Scoped strictly by the
  // lead's owner lens — a prior email-match here cross-contaminated test accounts
  // that shared an email (e.g. valrealestate pulling Chef Alex Forsythe's intake).
  // Prospect leads (client_id NULL -> 'av') get NO offer block, so their audit is
  // the unchanged AV marketing audit. Non-fatal: the audit still runs without it.
  const briefContext = await buildBriefContextForLens(lensForClient(lead.client_id));

  const payload = await generateAuditPayload(lead, briefContext);
  if (!payload) return null; // failure already logged to system_events
  const { aiScore, aiScoreBand, aiScoreReason, aiScoreBreakdown, auditContent } = payload;

  // Persist to leads. ai_audit gets the full JSON we received, for forensic
  // audit. audit_content is the rendered markdown. ai_last_scored_at marks
  // the row as scored so the cron sweep skips it next run.
  try {
    await db.execute<ResultSetHeader>(
      `UPDATE leads
          SET ai_score = ?,
              ai_score_band = ?,
              ai_score_reason = ?,
              ai_score_breakdown = ?,
              ai_audit = ?,
              audit_content = COALESCE(?, audit_content),
              audit_generated = NOW(),
              ai_last_scored_at = NOW(),
              ai_model_version = ?,
              last_activity_at = NOW()
        WHERE id = ?`,
      [
        aiScore,
        aiScoreBand,
        aiScoreReason,
        JSON.stringify(aiScoreBreakdown),
        payload.rawJson,
        auditContent,
        payload.model,
        lead.id
      ]
    );
  } catch (err) {
    await logEvent({
      eventType: 'ai.score_failed',
      leadId: lead.id,
      source: 'openai',
      status: 'failure',
      errorMessage: `db update failed: ${(err as Error).message.slice(0, 400)}`
    });
    return null;
  }

  // Living Score: ai_score (fit) just changed. Refresh ai_combined_score
  // so the dashboard's visible number reflects the new fit immediately.
  // Engagement delta is unchanged -- a Re-score is not an engagement event.
  await recomputeCombinedForLead(lead.id);

  // Persist under this lead's SELLER lens (multi-lens, no-drift): a Re-score for
  // one owner updates only that lens, never another owner's audit. The single
  // columns above stay the "current" view for back-compat.
  await saveLeadAudit({
    leadId: lead.id,
    lens: lensForClient(lead.client_id),
    auditContent,
    aiScore,
    aiScoreBand
  }).catch((e) => console.error('[auto-score:lens-save]', lead.id, (e as Error).message));

  const elapsedMs = Date.now() - start;

  // Emit the two success events the kickoff spec asks for: one for the
  // score, one for the audit. They land back-to-back but stay separately
  // queryable in /admin/events.
  await logEvent({
    eventType: 'ai.lead_scored',
    leadId: lead.id,
    source: 'openai',
    status: 'success',
    payload: {
      ai_score: aiScore,
      ai_score_band: aiScoreBand,
      breakdown: aiScoreBreakdown,
      model: payload.model,
      tokens_used: payload.tokensUsed,
      company: lead.company
    },
    executionTimeMs: elapsedMs
  });

  if (auditContent) {
    await logEvent({
      eventType: 'ai.audit_generated',
      leadId: lead.id,
      source: 'openai',
      status: 'success',
      payload: {
        audit_chars: auditContent.length,
        tokens_used: payload.tokensUsed,
        model: payload.model,
        company: lead.company
      },
      executionTimeMs: elapsedMs
    });

    // The call script (pain profile) is built FROM the audit, so refresh it now
    // that the audit just changed — fire-and-forget so the score response is fast.
    // Makes Re-score a one-click full intelligence refresh (audit + call script).
    extractPainProfileForLead(lead.id).catch((e) =>
      console.error('[auto-score:pain-refresh]', lead.id, (e as Error).message)
    );
  }

  return {
    aiScore,
    aiScoreBand,
    aiScoreReason,
    aiScoreBreakdown,
    auditContent,
    auditGenerated: new Date().toISOString(),
    modelVersion: payload.model,
    tokensUsed: payload.tokensUsed,
    skipped: false
  };
}

/**
 * Generate an audit + call brief for a lead under an EXPLICIT seller lens, and
 * persist it ONLY to that lens's row in lead_audits — never the leads columns.
 * This is the "generate the EBW / Atlantic & Vine pitch for this lead" path: a
 * lead Skip owns can also carry an Events by Water brief without disturbing
 * Skip's own (owner-lens) audit. The owner path above stays the single source
 * for the leads.audit_content "current" view.
 *
 * Returns the result for the generated lens, or null on bad lens / not found /
 * generation failure (logged to system_events). Awaits the matching call-script
 * (pain profile) for the lens so the lens is fully populated when this resolves.
 */
export async function scoreAndAuditLeadForLens(
  leadId: number,
  targetLens: string
): Promise<ScoreAndAuditResult | null> {
  const start = Date.now();
  const db = getAvDb();

  if (!isValidLens(targetLens)) return null;

  const [rows] = await db.execute<LeadRow[]>(
    `SELECT id, audit_id, company, contact_name, contact_title, email, phone, website,
            website_status,
            address_street, address_city, address_state, address_postal, address_country,
            industry, target_business, source_type, challenge, client_id
       FROM leads
      WHERE id = ?
        AND archived_at IS NULL
      LIMIT 1`,
    [leadId]
  );
  if (rows.length === 0) return null;
  const lead = rows[0];

  if (!hasMinimumData(lead)) {
    return {
      aiScore: null,
      aiScoreBand: null,
      aiScoreReason: null,
      aiScoreBreakdown: null,
      auditContent: null,
      auditGenerated: null,
      modelVersion: MODEL,
      tokensUsed: 0,
      skipped: true,
      skipReason: 'insufficient_data'
    };
  }

  const briefContext = await buildBriefContextForLens(targetLens);
  const payload = await generateAuditPayload(lead, briefContext);
  if (!payload) return null;

  // No-drift: write ONLY this lens's row. The leads columns (owner's current
  // view) are untouched.
  await saveLeadAudit({
    leadId: lead.id,
    lens: targetLens,
    auditContent: payload.auditContent,
    aiScore: payload.aiScore,
    aiScoreBand: payload.aiScoreBand
  });

  const elapsedMs = Date.now() - start;
  await logEvent({
    eventType: 'ai.audit_generated',
    leadId: lead.id,
    source: 'openai',
    status: 'success',
    payload: {
      lens: targetLens,
      audit_chars: payload.auditContent?.length ?? 0,
      tokens_used: payload.tokensUsed,
      model: payload.model,
      company: lead.company
    },
    executionTimeMs: elapsedMs
  });

  // Build the matching call script for THIS lens too (writes only the lens row).
  // Awaited so the lens picker shows a complete brief + script on first refresh.
  if (payload.auditContent) {
    await extractPainProfileForLeadLens(lead.id, targetLens, payload.auditContent).catch((e) =>
      console.error('[lens-gen:pain]', lead.id, targetLens, (e as Error).message)
    );
  }

  return {
    aiScore: payload.aiScore,
    aiScoreBand: payload.aiScoreBand,
    aiScoreReason: payload.aiScoreReason,
    aiScoreBreakdown: payload.aiScoreBreakdown,
    auditContent: payload.auditContent,
    auditGenerated: new Date().toISOString(),
    modelVersion: payload.model,
    tokensUsed: payload.tokensUsed,
    skipped: false
  };
}

function clamp01(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Convenience: fire-and-forget wrapper for insert paths. Logs any
 * thrown error to console but never propagates.
 */
export function scoreAndAuditLeadBackground(leadId: number): void {
  scoreAndAuditLead(leadId).catch((err) => {
    console.error('[auto-score]', leadId, (err as Error).message);
  });
}
