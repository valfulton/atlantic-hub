/**
 * lib/llm/router.ts  (#361, val 2026-06-02)
 *
 * One function call sites use: `runLlm(call)`. Internally it:
 *
 *   1. Picks the model from the task kind (TASK_MODEL in types.ts).
 *   2. Computes the cache key + checks the cache. Hit -> return cached text,
 *      log the saved cost.
 *   3. Miss -> route to the provider, get the response, store in cache (if
 *      policy allows), log the actual cost.
 *
 * Today only the OpenAI provider is wired (the rest are stubbed below; flip
 * them on by importing the right client + replacing the throw). Adding a
 * provider is one file change, not a call-site sweep.
 *
 * All call sites stay model-agnostic. Want to swap brand-kit-extract to
 * Gemini Flash? Edit TASK_MODEL in types.ts, set GEMINI_API_KEY, done.
 */
import { openaiChatCompletion } from '@/lib/openai/client';
import {
  openRouterChatCompletion,
  hasOpenRouterKey,
  OpenRouterTransientError
} from './providers/openrouter';
import {
  geminiChatCompletion,
  hasGeminiKey,
  GeminiTransientError
} from './providers/gemini';
import {
  TASK_MODEL,
  TASK_CACHE,
  MODEL_PRICE,
  type LlmCall,
  type LlmCallResult,
  type ModelId,
  type Provider
} from './types';
import { cacheKeyFor, lookupCache, storeCache } from './cache';
import { logLlmCall } from './log';

function providerOf(model: ModelId): Provider {
  return model.split(':')[0] as Provider;
}

function modelNameOf(model: ModelId): string {
  return model.slice(model.indexOf(':') + 1);
}

/** Compute cost in microcents from token counts + model price table. */
function estimateCost(model: ModelId, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICE[model];
  if (!price) return 0;
  const inCost = Math.round((price.inputMicrocentsPerMillion * inputTokens) / 1_000_000);
  const outCost = Math.round((price.outputMicrocentsPerMillion * outputTokens) / 1_000_000);
  return inCost + outCost;
}

class UnsupportedProviderError extends Error {
  constructor(provider: Provider) {
    super(`LLM provider '${provider}' is not reachable. Set OPENROUTER_API_KEY (covers all providers) or wire the provider's direct client.`);
    this.name = 'UnsupportedProviderError';
  }
}

/** Translate our internal ModelId -> the model string OpenRouter expects.
 *  OpenRouter uses `provider/model` slugs; free-tier rows are `provider/model:free`. */
function toOpenRouterModelString(model: ModelId): string {
  // Free-tier ids carry the ':free' suffix as part of their ModelId.
  // Our parser splits on FIRST colon only, so 'meta-llama:llama-3.2-3b-instruct:free'
  // becomes provider='meta-llama', name='llama-3.2-3b-instruct:free'. Reassemble.
  const firstColon = model.indexOf(':');
  if (firstColon < 0) return model;
  const provider = model.slice(0, firstColon);
  const name = model.slice(firstColon + 1);
  return `${provider}/${name}`;
}

/**
 * Call the provider directly (no cache, no log) — used by runLlm after a cache
 * miss. Returns text + token counts.
 *
 * Resilience: when OpenRouter is the chosen route and returns a transient
 * error (5xx, timeout, rate limit), we fall back to direct OpenAI IF the model
 * is an OpenAI model. Non-OpenAI models propagate the error — no silent route
 * to the wrong model.
 */
async function callProvider(
  model: ModelId,
  prompt: string,
  opts: { temperature?: number; maxTokens?: number; json?: boolean }
): Promise<{ text: string; inputTokens: number; outputTokens: number; viaProvider: 'openrouter' | 'openai_direct' | 'gemini_direct' }> {
  const provider = providerOf(model);

  // Preferred path: OpenRouter (covers every provider via one key).
  if (hasOpenRouterKey()) {
    try {
      const res = await openRouterChatCompletion(
        [{ role: 'user', content: prompt }],
        {
          model: toOpenRouterModelString(model),
          temperature: opts.temperature,
          maxTokens: opts.maxTokens,
          json: opts.json
        }
      );
      return {
        text: res.text,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        viaProvider: 'openrouter'
      };
    } catch (e) {
      // Fall back on transient errors, by provider:
      //   - OpenAI models -> direct OpenAI below
      //   - Google models -> direct Gemini below (if GEMINI_API_KEY set)
      //   - Others -> propagate, no second path
      if (e instanceof OpenRouterTransientError) {
        if (provider === 'openai') {
          // fall through to direct-OpenAI branch below
        } else if (provider === 'google' && hasGeminiKey()) {
          // fall through to direct-Gemini branch below
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }
  }

  // Direct-Gemini path (resilience fallback + free-tier headroom).
  if (provider === 'google' && hasGeminiKey()) {
    try {
      const res = await geminiChatCompletion(prompt, {
        model: modelNameOf(model),
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        json: opts.json
      });
      return {
        text: res.text,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        viaProvider: 'gemini_direct'
      };
    } catch (e) {
      if (e instanceof GeminiTransientError) {
        // No deeper fallback for Google models without OpenAI equivalent.
        // Propagate so the caller sees the real error.
      }
      throw e;
    }
  }

  // Direct-OpenAI fallback (and primary when OPENROUTER_API_KEY is unset).
  if (provider === 'openai') {
    const res = await openaiChatCompletion(
      [{ role: 'user', content: prompt }],
      {
        model: modelNameOf(model),
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        json: opts.json
      }
    );
    return {
      text: res.text,
      inputTokens: res.usage.promptTokens,
      outputTokens: res.usage.completionTokens,
      viaProvider: 'openai_direct'
    };
  }

  // Non-OpenAI model, no OpenRouter key set. Tell the caller exactly what's wrong.
  throw new UnsupportedProviderError(provider);
}

/**
 * The one function call sites use. Cache-aware, log-aware, model-aware.
 */
export async function runLlm(call: LlmCall): Promise<LlmCallResult> {
  const model = TASK_MODEL[call.taskKind];
  const cachePolicy = TASK_CACHE[call.taskKind];

  // -------- 1. Cache lookup (if policy allows) -----------------------------
  let cacheKey: string | null = null;
  if (cachePolicy.kind !== 'none') {
    cacheKey = cacheKeyFor(model, call.prompt, call.cacheKeyExtras ?? []);
    const hit = await lookupCache(cacheKey);
    if (hit.hit && typeof hit.text === 'string') {
      // Log as a $0 cache hit — but record what the live call WOULD have cost,
      // so monthly reporting can show "saved $X by caching".
      const savedCost = estimateCost(model, hit.inputTokens ?? 0, hit.outputTokens ?? 0);
      void logLlmCall({
        tenantId: call.tenantId ?? 'av',
        clientId: call.clientId ?? null,
        taskKind: call.taskKind,
        model,
        inputTokens: 0,
        outputTokens: 0,
        costMicrocents: 0,
        source: 'cache',
        note: call.note ?? `${call.taskKind} (cache; saved ~${(savedCost / 1000).toFixed(2)}¢)`
      });
      return {
        text: hit.text,
        model,
        inputTokens: 0,
        outputTokens: 0,
        costMicrocents: 0,
        source: 'cache'
      };
    }
  }

  // -------- 2. Live provider call ------------------------------------------
  const provResult = await callProvider(model, call.prompt, {
    temperature: call.temperature,
    maxTokens: call.maxTokens,
    json: call.json
  });
  const costMicrocents = estimateCost(model, provResult.inputTokens, provResult.outputTokens);

  // -------- 3. Cache store (if policy allows) ------------------------------
  if (cachePolicy.kind !== 'none' && cacheKey) {
    const expiresAt = cachePolicy.kind === 'time' && cachePolicy.ttlSeconds
      ? new Date(Date.now() + cachePolicy.ttlSeconds * 1000)
      : null;
    void storeCache({
      cacheKey,
      model,
      taskKind: call.taskKind,
      responseText: provResult.text,
      inputTokens: provResult.inputTokens,
      outputTokens: provResult.outputTokens,
      costMicrocents,
      expiresAt
    });
  }

  // -------- 4. Log the call ------------------------------------------------
  void logLlmCall({
    tenantId: call.tenantId ?? 'av',
    clientId: call.clientId ?? null,
    taskKind: call.taskKind,
    model,
    inputTokens: provResult.inputTokens,
    outputTokens: provResult.outputTokens,
    costMicrocents,
    source: 'live',
    note: call.note
      ? `${call.note} · via ${provResult.viaProvider}`
      : `${call.taskKind} · via ${provResult.viaProvider}`
  });

  return {
    text: provResult.text,
    model,
    inputTokens: provResult.inputTokens,
    outputTokens: provResult.outputTokens,
    costMicrocents,
    source: 'live'
  };
}
