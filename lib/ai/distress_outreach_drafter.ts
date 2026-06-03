/**
 * lib/ai/distress_outreach_drafter.ts  (#382, val 2026-06-03)
 *
 * Distress-watchlist outreach drafter. Different from the lead-based
 * outreach_drafter — there is NO lead row here. We have a distress entity
 * (company name, region, contributing signals, cascade attribution) plus
 * the operator's client (their offer + voice). Output: a subject + body the
 * operator can copy or push into a campaign.
 *
 * The point: turn institutional memory into a sales artifact in one click.
 * The email body literally references the public-records signal — that's
 * the cascade attribution layer (#375) rendered into action.
 *
 * Cost: ~$0.003-0.008 per draft via runLlm under 'outreach_draft' task.
 */
import { runLlm } from '@/lib/llm/router';
import { parseOpenAIJson } from '@/lib/llm/parse';
import { entityAttribution, type EntityAttribution } from '@/lib/public_intel/attribution';
import { getBriefSeed } from '@/lib/client/brief_store';
import { logEvent } from '@/lib/events/log';

export interface DistressDraftInput {
  clientId: number;
  entityKey: string;
  /** Display label of the entity (e.g. "Acme Logistics LLC"). */
  entityLabel: string | null;
  /** Distress score from the rescore. */
  score: number;
  /** Signal kinds contributing — for prompt context. */
  signalKinds: string[];
  /** State / region code, when known. */
  regionCode: string | null;
}

export interface DistressDraftResult {
  subject: string;
  body: string;
  /** The attribution that the email body references (for operator review). */
  attribution: EntityAttribution | null;
  model: string;
  tokensUsed: number;
  costMicrocents: number;
}

interface DraftJson {
  subject: string;
  body: string;
}

const SIGNAL_HUMAN: Record<string, string> = {
  new_llc: 'recently formed CA LLC',
  suspended_entity: 'CA Secretary of State suspension',
  dissolved_entity: 'recently dissolved entity',
  high_denial_rate: 'high mortgage denial rate in their tract',
  high_refinance_volume: 'high refinance volume in their tract',
  complaint_velocity_high: 'rising CFPB complaint velocity',
  lender_under_fire: 'lender under regulatory pressure',
  lawsuit_filed: 'federal court filing',
  bankruptcy_filed: 'bankruptcy filing',
  ucc_filing: 'UCC filing',
  credit_risk_increase: 'credit risk increase',
  negative_review_trend: 'Google review trend decline',
  rapid_growth: 'rapid growth signals'
};

export async function draftDistressOutreach(input: DistressDraftInput): Promise<DistressDraftResult> {
  const started = Date.now();

  // Pull cascade attribution — the moat surfaced into the email body.
  const attribution = await entityAttribution(input.clientId, input.entityKey);

  // Pull client's offer + voice from their intake-derived brief.
  const seed = await getBriefSeed('av', input.clientId);

  const clientOffer: string[] = [];
  if (seed) {
    if (seed.businessDescription) clientOffer.push(`What we sell: ${seed.businessDescription}`);
    if (seed.slogan) clientOffer.push(`Tagline: ${seed.slogan}`);
    if (seed.keyMessage) clientOffer.push(`Single key message: ${seed.keyMessage}`);
    if (seed.differentiators) clientOffer.push(`What makes us different: ${seed.differentiators}`);
    if (seed.messageSupport) clientOffer.push(`Proof: ${seed.messageSupport}`);
    if (seed.brandVoice) clientOffer.push(`Brand voice: ${seed.brandVoice}`);
  }

  const signalSummary = input.signalKinds
    .map((k) => SIGNAL_HUMAN[k] ?? k)
    .slice(0, 3)
    .join(' + ');

  const systemPrompt = [
    'You write cold outreach openers from one business owner to another.',
    'TONE: confident, specific, human. Never robotic. No "I hope this finds you well." No "I noticed your website."',
    'CONSTRAINTS: subject 35-60 chars, body 80-140 words. Single specific observation. Clear soft CTA (a question or a brief next-step offer). No buzzwords. No "AI", no "our intelligence engine".',
    'CRITICAL: The email must reference the public-records signal in ONE sentence — be specific and grounded ("I noticed a federal filing land in your area", "I saw a recent suspension on a UCC counterparty of yours"), but NEVER name the data source by name. The prospect should think you have your finger on the pulse, not that you bought a database feed.',
    'OUTPUT: respond with strict JSON only — { "subject": "...", "body": "..." }. No prose outside the JSON.'
  ].join('\n');

  const userParts: string[] = [];
  userParts.push(`PROSPECT: ${input.entityLabel ?? input.entityKey}`);
  if (input.regionCode) userParts.push(`REGION: ${input.regionCode}`);
  userParts.push(`DISTRESS_SCORE: ${input.score} (higher = more relevant to us right now)`);
  if (signalSummary) userParts.push(`PUBLIC_SIGNAL: ${signalSummary}`);
  userParts.push('');
  if (clientOffer.length > 0) {
    userParts.push('OUR OFFER (we are reaching out as this business — write from our vantage):');
    userParts.push('- ' + clientOffer.join('\n- '));
    userParts.push('');
  }
  if (attribution) {
    userParts.push('CASCADE_ATTRIBUTION (use ONE specific sentence referencing this signal — never name the data source):');
    userParts.push(attribution.promptLine);
    userParts.push('');
  }
  userParts.push('Now draft the email. Respond ONLY with the JSON object specified.');

  const completion = await runLlm({
    taskKind: 'outreach_draft',
    clientId: input.clientId,
    note: `distress_outreach · ${input.entityKey}`,
    prompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userParts.join('\n')}`,
    temperature: 0.7,
    maxTokens: 600,
    json: true
  });

  const parsed = parseOpenAIJson<DraftJson>(completion.text);
  if (!parsed || typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') {
    throw new Error('LLM returned malformed JSON for distress outreach draft');
  }

  await logEvent({
    eventType: 'distress.outreach_drafted',
    source: 'llm_router',
    executionTimeMs: Date.now() - started,
    payload: {
      client_id: input.clientId,
      entity_key: input.entityKey,
      score: input.score,
      attribution_used: !!attribution,
      model: completion.model,
      tokens: completion.inputTokens + completion.outputTokens,
      cost_microcents: completion.costMicrocents
    }
  });

  return {
    subject: parsed.subject.trim().slice(0, 100),
    body: parsed.body.trim(),
    attribution,
    model: completion.model,
    tokensUsed: completion.inputTokens + completion.outputTokens,
    costMicrocents: completion.costMicrocents
  };
}
