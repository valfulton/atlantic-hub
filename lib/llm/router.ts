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
    super(`LLM provider '${provider}' is not wired yet. Add the client + env key, then enable in router.ts.`);
    this.name = 'UnsupportedProviderError';
  }
}

/**
 * Call the provider directly (no cache, no log) — used by runLlm after a cache
 * miss. Returns text + token counts.
 */
async function callProvider(
  model: ModelId,
  prompt: string,
  opts: { temperature?: number; maxTokens?: number; json?: boolean }
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const provider = providerOf(model);
  const modelName = modelNameOf(model);

  if (provider === 'openai') {
    const res = await openaiChatCompletion(
      [{ role: 'user', content: prompt }],
      {
        model: modelName,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        json: opts.json
      }
    );
    return {
      text: res.text,
      inputTokens: res.usage.promptTokens,
      outputTokens: res.usage.completionTokens
    };
  }

  // Stubs — provider client + env key not wired yet. Throwing here keeps the
  // contract honest: a future task swap to a non-wired provider fails loud
  // rather than silently routing to the wrong model.
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
