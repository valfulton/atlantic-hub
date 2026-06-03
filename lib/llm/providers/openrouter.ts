/**
 * lib/llm/providers/openrouter.ts  (#362, val 2026-06-02)
 *
 * OpenRouter is the unified gateway — one API key, 400+ models, OpenAI-compatible
 * API. We talk to it via raw fetch (no SDK) to keep the Netlify function bundle
 * small.
 *
 * Resilience contract:
 *   - 5xx or network errors throw OpenRouterTransientError so the router can
 *     fall back to direct OpenAI (when the model is an OpenAI model).
 *   - 4xx errors throw OpenRouterPermanentError (bad model name, invalid key,
 *     rate limit hit) — caller decides if a retry is warranted.
 *
 * NEVER LOGS THE KEY. NEVER LOGS THE FULL RESPONSE BODY.
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const TIMEOUT_MS = 60_000;

export class OpenRouterKeyMissingError extends Error {
  constructor() {
    super('OPENROUTER_API_KEY is not set in Netlify environment variables');
    this.name = 'OpenRouterKeyMissingError';
  }
}

export class OpenRouterTransientError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(`OpenRouter transient: ${message}`);
    this.name = 'OpenRouterTransientError';
    this.status = status;
  }
}

export class OpenRouterPermanentError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`OpenRouter ${status}: ${body.slice(0, 200)}`);
    this.name = 'OpenRouterPermanentError';
    this.status = status;
  }
}

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterCompletionOptions {
  /** OpenRouter model id: e.g. 'openai/gpt-4o-mini' or 'anthropic/claude-3.5-haiku' or 'meta-llama/llama-3.2-3b-instruct:free'. */
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Set true to demand JSON output (when the model supports response_format). */
  json?: boolean;
}

export interface OpenRouterCompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

function isTransientStatus(status: number): boolean {
  // 408 timeout, 429 rate limit (transient — back off + retry), 5xx server errors.
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

export async function openRouterChatCompletion(
  messages: OpenRouterMessage[],
  options: OpenRouterCompletionOptions
): Promise<OpenRouterCompletionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new OpenRouterKeyMissingError();

  const body: Record<string, unknown> = {
    model: options.model,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 1500
  };
  if (options.json) {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter likes a Referer + Title so they can show usage in your dashboard.
        // Non-load-bearing; safe to omit but worth setting.
        'HTTP-Referer': 'https://atlantic-hub.netlify.app',
        'X-Title': 'Atlantic Hub'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    const name = e instanceof Error ? e.name : 'fetch_error';
    throw new OpenRouterTransientError(name === 'AbortError' ? 'timeout' : 'network', null);
  }
  clearTimeout(timer);

  const text = await resp.text();
  if (!resp.ok) {
    if (isTransientStatus(resp.status)) {
      throw new OpenRouterTransientError(`HTTP ${resp.status}`, resp.status);
    }
    throw new OpenRouterPermanentError(resp.status, text);
  }

  interface OpenRouterApiResponse {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }
  let parsed: OpenRouterApiResponse;
  try {
    parsed = JSON.parse(text) as OpenRouterApiResponse;
  } catch {
    throw new OpenRouterTransientError('response_parse_failed');
  }

  const content = parsed.choices?.[0]?.message?.content ?? '';
  return {
    text: content,
    inputTokens: parsed.usage?.prompt_tokens ?? 0,
    outputTokens: parsed.usage?.completion_tokens ?? 0
  };
}

/** Returns true when an OPENROUTER_API_KEY is set in env. */
export function hasOpenRouterKey(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}
