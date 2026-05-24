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
import { extractBriefSeedFromIntake } from '@/lib/client/intake_brief';
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
  industry: string | null;
  target_business: 'av' | 'ebw' | 'both';
  source_type: string;
  challenge: string | null;
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

const SYSTEM_INSTRUCTIONS = `You are a senior B2B marketing strategist working for Atlantic & Vine, an AI-native marketing intelligence platform. You score and audit prospective leads for the operator.

Your output is ALWAYS valid JSON matching this exact shape:
{
  "ai_score": <integer 0-100>,
  "ai_score_band": "hot" | "warm" | "cool",
  "ai_score_reason": "<one or two crisp sentences explaining the score>",
  "ai_score_breakdown": {
    "fit": <integer 0-100>,
    "intent": <integer 0-100>,
    "reachability": <integer 0-100>,
    "icp_match": <integer 0-100>
  },
  "audit_content": "<markdown strategic marketing audit, 300-600 words>"
}

Scoring rubric:
- fit:          how well their business matches an Atlantic & Vine offering (lead-gen, audits, AI content, websites)
- intent:       evidence they may be actively looking for help (recent activity, growth signals, gaps)
- reachability: how easy it will be to actually contact a decision-maker (real email, phone, website, named contact)
- icp_match:    proximity to ideal customer profile (service business, SMB, owner-operated, not yet using AI)

Band thresholds:
- hot:  ai_score >= 75 -- pursue this week
- warm: 50 <= ai_score < 75 -- nurture, drip outreach
- cool: ai_score < 50 -- low priority, queue for batch outreach only

The audit_content is the deliverable the operator may share with this prospect. Write it as a real strategic marketing audit -- 4-6 short sections in markdown with H2/H3 headers, addressing their likely positioning gap, content gap, conversion gap, and one specific recommended next step. No filler. No fake stats. No promises Atlantic & Vine cannot keep. Plural voice ("our team", "we recommend"). Never use the founder's name. Never use em-dashes or smart quotes -- ASCII only.

Never wrap the JSON in markdown code fences. Return JSON only.`;

function buildUserPrompt(lead: LeadRow, briefContext?: string | null): string {
  const lines: string[] = [];
  lines.push(`Score and audit the following prospective business.`);
  lines.push('');
  lines.push(`Company: ${lead.company}`);
  if (lead.industry) lines.push(`Industry: ${lead.industry}`);
  if (lead.website) lines.push(`Website: ${lead.website}`);
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
            industry, target_business, source_type, challenge
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

  // If this lead belongs to a client account (matched by their real email),
  // ground the audit in the client's OWN intake/brief answers instead of
  // guessing. Prospect leads (no matching client_user) get no brief context, so
  // their audit is unchanged. Non-fatal: the audit still runs without it.
  let briefContext: string | null = null;
  try {
    if (lead.email && !/^(prospect|apollo|noemail)\+/i.test(lead.email)) {
      const [cuRows] = await db.execute<(RowDataPacket & { intake_payload: unknown })[]>(
        `SELECT intake_payload FROM client_users
          WHERE email = ? AND archived_at IS NULL
          ORDER BY client_user_id DESC LIMIT 1`,
        [lead.email]
      );
      if (cuRows[0]?.intake_payload) {
        const seed = extractBriefSeedFromIntake(cuRows[0].intake_payload);
        const parts: string[] = [];
        if (seed.whyAdvertise) parts.push(`Why they advertise: ${seed.whyAdvertise}`);
        if (seed.goals) parts.push(`Their 90-day goals: ${seed.goals}`);
        if (seed.audience) parts.push(`Their target audience: ${seed.audience}`);
        if (seed.audienceInsights) parts.push(`What they know about that audience: ${seed.audienceInsights}`);
        if (seed.keyMessage) parts.push(`Their single key message: ${seed.keyMessage}`);
        if (seed.messageSupport) parts.push(`Proof behind it: ${seed.messageSupport}`);
        if (seed.differentiators) parts.push(`What makes them different: ${seed.differentiators}`);
        if (seed.brandVoice) parts.push(`Brand voice: ${seed.brandVoice}`);
        if (seed.competitors) parts.push(`Competitors they named: ${seed.competitors}`);
        if (parts.length) {
          briefContext =
            'The client completed an intake brief in their own words. Ground the audit in these and do not contradict them:\n- ' +
            parts.join('\n- ');
        }
      }
    }
  } catch {
    /* non-fatal: audit proceeds without the brief context */
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

  // Clamp and sanitize
  const aiScore = Math.max(0, Math.min(100, Math.round(parsed.ai_score)));
  const aiScoreBand: ScoreBand =
    parsed.ai_score_band === 'hot' || parsed.ai_score_band === 'warm' || parsed.ai_score_band === 'cool'
      ? parsed.ai_score_band
      : aiScore >= 75
      ? 'hot'
      : aiScore >= 50
      ? 'warm'
      : 'cool';
  const aiScoreReason = typeof parsed.ai_score_reason === 'string' ? parsed.ai_score_reason.slice(0, 2000) : null;
  const aiScoreBreakdown: ScoreBreakdown = {
    fit: clamp01(parsed.ai_score_breakdown?.fit),
    intent: clamp01(parsed.ai_score_breakdown?.intent),
    reachability: clamp01(parsed.ai_score_breakdown?.reachability),
    icp_match: clamp01(parsed.ai_score_breakdown?.icp_match)
  };
  const auditContent = typeof parsed.audit_content === 'string' ? parsed.audit_content : null;

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
        JSON.stringify(parsed),
        auditContent,
        completion.model || MODEL,
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
      model: completion.model,
      tokens_used: completion.usage.totalTokens,
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
        tokens_used: completion.usage.totalTokens,
        model: completion.model,
        company: lead.company
      },
      executionTimeMs: elapsedMs
    });
  }

  return {
    aiScore,
    aiScoreBand,
    aiScoreReason,
    aiScoreBreakdown,
    auditContent,
    auditGenerated: new Date().toISOString(),
    modelVersion: completion.model || MODEL,
    tokensUsed: completion.usage.totalTokens,
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
