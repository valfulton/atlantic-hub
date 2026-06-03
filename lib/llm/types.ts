/**
 * lib/llm/types.ts  (#361, val 2026-06-02)
 *
 * The shared vocabulary of the LLM router.
 *
 * Task kinds are the abstraction val uses when she's thinking about cost:
 * "is this an expensive synthesis step or a cheap extraction?" The router
 * maps each task kind to a model. Add a new task = add an entry to TASK_MODEL.
 */

export type Provider = 'openai' | 'anthropic' | 'google' | 'deepseek' | 'groq';

/**
 * Canonical model identifier — `provider:model`. Caller code uses task kinds;
 * the router resolves to one of these.
 */
export type ModelId =
  | 'openai:gpt-4o'
  | 'openai:gpt-4o-mini'
  | 'openai:gpt-4-turbo'
  | 'anthropic:claude-sonnet-4-6'
  | 'anthropic:claude-haiku-3-5'
  | 'google:gemini-1.5-flash'
  | 'google:gemini-1.5-pro'
  | 'deepseek:deepseek-v3'
  | 'groq:llama-3.3-70b';

/**
 * Task kinds — what a step is FOR, not what model runs it. The router decides
 * which model fits which task. New steps add a kind here + an entry in
 * TASK_MODEL below.
 */
export type TaskKind =
  | 'brand_kit_extract'      // colors / logo / aesthetic from page HTML — cheap
  | 'intake_web_fill'        // draft intake fields from a website — mid
  | 'icp_sharpen'            // synthesize ICP from brief — strategic
  | 'intake_intel_extract'   // distill brief into intelligence_objects — strategic
  | 'narrative_line_propose' // draft narrative-line candidates — strategic
  | 'lead_audit'             // generate a sales-call brief for a lead — strategic
  | 'pain_extract'           // extract pain themes from a lead's site — mid
  | 'outreach_draft'         // draft a personalized outreach email — mid
  | 'commercial_voice'       // VO script for a commercial — mid
  | 'pr_match'               // match a PR opportunity to lead/client — mid
  | 'social_caption'         // social post caption — cheap
  | 'misc';                  // catch-all fallback

/**
 * Per-million-token prices in MICRO-CENTS (1/1000 of a cent), input + output.
 * Updated 2026-06; treat as approximate. Used for cost estimation only — actual
 * provider invoicing wins if there's a discrepancy. Keeping integers (microcents)
 * means no floating-point creep in monthly rollups.
 */
export interface ModelPrice {
  inputMicrocentsPerMillion: number;
  outputMicrocentsPerMillion: number;
}

/** $0.15 per million = 15 cents per million = 15,000 microcents per million. */
function dollarsToMicrocents(perMillion: number): number {
  return Math.round(perMillion * 100_000);
}

export const MODEL_PRICE: Record<ModelId, ModelPrice> = {
  'openai:gpt-4o': {
    inputMicrocentsPerMillion: dollarsToMicrocents(2.50),
    outputMicrocentsPerMillion: dollarsToMicrocents(10.00)
  },
  'openai:gpt-4o-mini': {
    inputMicrocentsPerMillion: dollarsToMicrocents(0.15),
    outputMicrocentsPerMillion: dollarsToMicrocents(0.60)
  },
  'openai:gpt-4-turbo': {
    inputMicrocentsPerMillion: dollarsToMicrocents(10.00),
    outputMicrocentsPerMillion: dollarsToMicrocents(30.00)
  },
  'anthropic:claude-sonnet-4-6': {
    inputMicrocentsPerMillion: dollarsToMicrocents(3.00),
    outputMicrocentsPerMillion: dollarsToMicrocents(15.00)
  },
  'anthropic:claude-haiku-3-5': {
    inputMicrocentsPerMillion: dollarsToMicrocents(0.80),
    outputMicrocentsPerMillion: dollarsToMicrocents(4.00)
  },
  'google:gemini-1.5-flash': {
    inputMicrocentsPerMillion: dollarsToMicrocents(0.075),
    outputMicrocentsPerMillion: dollarsToMicrocents(0.30)
  },
  'google:gemini-1.5-pro': {
    inputMicrocentsPerMillion: dollarsToMicrocents(1.25),
    outputMicrocentsPerMillion: dollarsToMicrocents(5.00)
  },
  'deepseek:deepseek-v3': {
    inputMicrocentsPerMillion: dollarsToMicrocents(0.14),
    outputMicrocentsPerMillion: dollarsToMicrocents(0.28)
  },
  'groq:llama-3.3-70b': {
    inputMicrocentsPerMillion: dollarsToMicrocents(0.59),
    outputMicrocentsPerMillion: dollarsToMicrocents(0.79)
  }
};

/**
 * Task → model mapping. EVERY task kind has a default model here. To swap a
 * task to a different model: change ONE line.
 *
 * The current defaults follow the strategy:
 *   - Cheap routine work → gpt-4o-mini (already wired; safe default).
 *   - Strategic synthesis → gpt-4o.
 *   - Future swaps once env keys land: brand_kit → gemini-1.5-flash (~95% cheaper),
 *     intake_web_fill → claude-haiku-3-5, icp_sharpen → claude-sonnet-4-6.
 */
export const TASK_MODEL: Record<TaskKind, ModelId> = {
  brand_kit_extract: 'openai:gpt-4o-mini',
  intake_web_fill: 'openai:gpt-4o-mini',
  icp_sharpen: 'openai:gpt-4o',
  intake_intel_extract: 'openai:gpt-4o',
  narrative_line_propose: 'openai:gpt-4o',
  lead_audit: 'openai:gpt-4o',
  pain_extract: 'openai:gpt-4o-mini',
  outreach_draft: 'openai:gpt-4o-mini',
  commercial_voice: 'openai:gpt-4o-mini',
  pr_match: 'openai:gpt-4o-mini',
  social_caption: 'openai:gpt-4o-mini',
  misc: 'openai:gpt-4o-mini'
};

/**
 * Cache strategy per task kind.
 *   - 'time' + ttlSeconds : evict after the TTL (good for web-fetched content
 *     that doesn't change hourly).
 *   - 'event' : cache key includes a source updated_at; lookups against a fresh
 *     source naturally miss, no TTL needed.
 *   - 'none' : never cache (good for anything user-creative or time-sensitive).
 */
export interface CachePolicy {
  kind: 'time' | 'event' | 'none';
  ttlSeconds?: number;
}

const SEVEN_DAYS = 7 * 24 * 60 * 60;

export const TASK_CACHE: Record<TaskKind, CachePolicy> = {
  brand_kit_extract: { kind: 'time', ttlSeconds: SEVEN_DAYS },
  intake_web_fill: { kind: 'time', ttlSeconds: SEVEN_DAYS },
  pain_extract: { kind: 'time', ttlSeconds: SEVEN_DAYS },
  icp_sharpen: { kind: 'event' },             // invalidated by brief.updated_at in cache key
  intake_intel_extract: { kind: 'event' },
  narrative_line_propose: { kind: 'event' },
  lead_audit: { kind: 'event' },
  pr_match: { kind: 'time', ttlSeconds: 60 * 60 }, // 1 hour
  outreach_draft: { kind: 'none' },           // creative output, never reuse
  commercial_voice: { kind: 'none' },
  social_caption: { kind: 'none' },
  misc: { kind: 'none' }
};

export interface LlmCall {
  taskKind: TaskKind;
  /** Free-form note for accounting/UI. e.g. "brand-kit for client 11". */
  note?: string;
  /** When known, scopes the call to a brand for per-client spend reporting. */
  clientId?: number | null;
  /** Tenant. Default 'av'. */
  tenantId?: string;
  /** The full prompt -- includes system + user messages serialised together. */
  prompt: string;
  /** Cache-key extras: if you pass brief.updated_at here, an event-cached
   *  task automatically invalidates when the source updates. */
  cacheKeyExtras?: string[];
  /** Pass-through completion options. */
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

export interface LlmCallResult {
  text: string;
  model: ModelId;
  inputTokens: number;
  outputTokens: number;
  costMicrocents: number;
  source: 'live' | 'cache';
}
