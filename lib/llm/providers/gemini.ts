/**
 * lib/llm/providers/gemini.ts  (#366, val 2026-06-02)
 *
 * Direct Google Gemini API client. Used as the resilience fallback for Gemini
 * models when OpenRouter is unhealthy, and as a parallel free-tier bucket
 * (Google directly gives 15 RPM / 1500 RPD on Flash, separate from OpenRouter's
 * rate limits).
 *
 * Endpoint: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *
 * NEVER LOGS THE KEY. NEVER LOGS FULL RESPONSE BODIES.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 60_000;

export class GeminiKeyMissingError extends Error {
  constructor() {
    super('GEMINI_API_KEY is not set in Netlify environment variables');
    this.name = 'GeminiKeyMissingError';
  }
}

export class GeminiTransientError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(`Gemini transient: ${message}`);
    this.name = 'GeminiTransientError';
    this.status = status;
  }
}

export class GeminiPermanentError extends Error {
  status: number;
  constructor(status: number, body: string) {
    super(`Gemini ${status}: ${body.slice(0, 200)}`);
    this.name = 'GeminiPermanentError';
    this.status = status;
  }
}

export interface GeminiCompletionOptions {
  /** Gemini model name without the 'google/' prefix, e.g. 'gemini-1.5-flash'. */
  model: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

export interface GeminiCompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

/**
 * Gemini's API takes a single combined prompt string in its `contents` field.
 * We pass system + user content concatenated.
 */
export async function geminiChatCompletion(
  prompt: string,
  options: GeminiCompletionOptions
): Promise<GeminiCompletionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiKeyMissingError();

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxTokens ?? 1500,
      ...(options.json ? { responseMimeType: 'application/json' } : {})
    }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(`${GEMINI_BASE}/${encodeURIComponent(options.model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    const name = e instanceof Error ? e.name : 'fetch_error';
    throw new GeminiTransientError(name === 'AbortError' ? 'timeout' : 'network');
  }
  clearTimeout(timer);

  const text = await resp.text();
  if (!resp.ok) {
    if (isTransientStatus(resp.status)) throw new GeminiTransientError(`HTTP ${resp.status}`, resp.status);
    throw new GeminiPermanentError(resp.status, text);
  }

  interface GeminiApiResponse {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  }
  let parsed: GeminiApiResponse;
  try {
    parsed = JSON.parse(text) as GeminiApiResponse;
  } catch {
    throw new GeminiTransientError('response_parse_failed');
  }

  const content = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return {
    text: content,
    inputTokens: parsed.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: parsed.usageMetadata?.candidatesTokenCount ?? 0
  };
}

export function hasGeminiKey(): boolean {
  return !!process.env.GEMINI_API_KEY;
}
