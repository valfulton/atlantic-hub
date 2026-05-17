/**
 * lib/openai/client.ts
 *
 * Minimal OpenAI chat-completions client. No SDK dependency — direct fetch
 * to keep the Netlify function bundle small. Used by:
 *   - AI social content generator
 *   - (future) AI outreach drafter
 *   - (future) AI commercial generator
 *
 * Reads OPENAI_API_KEY from process.env.
 *
 * Default model: gpt-4o-mini ($0.15/$0.60 per 1M tokens) — cheap enough for
 * dozens of generations per lead. Override per call via { model } option.
 */

const OPENAI_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

export class OpenAIKeyMissingError extends Error {
  constructor() {
    super('OPENAI_API_KEY is not set in Netlify environment variables');
    this.name = 'OpenAIKeyMissingError';
  }
}

export class OpenAIApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`OpenAI API error ${status}: ${body.slice(0, 200)}`);
    this.name = 'OpenAIApiError';
    this.status = status;
    this.body = body;
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Request JSON output via response_format. Caller is responsible for prompting "respond in JSON". */
  json?: boolean;
}

export interface ChatCompletionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatCompletionResult {
  text: string;
  usage: ChatCompletionUsage;
  model: string;
  finishReason: string | null;
}

/**
 * Send a chat-completion request. Returns the assistant message text + token usage.
 */
export async function openaiChatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): Promise<ChatCompletionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new OpenAIKeyMissingError();

  const body: Record<string, unknown> = {
    model: options.model ?? DEFAULT_MODEL,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 1500
  };
  if (options.json) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new OpenAIApiError(res.status, errBody);
  }

  const json = (await res.json()) as {
    choices: Array<{ message: { content: string }; finish_reason: string | null }>;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    model: string;
  };

  return {
    text: json.choices[0]?.message?.content ?? '',
    usage: {
      promptTokens: json.usage.prompt_tokens,
      completionTokens: json.usage.completion_tokens,
      totalTokens: json.usage.total_tokens
    },
    model: json.model,
    finishReason: json.choices[0]?.finish_reason ?? null
  };
}

/**
 * Safe JSON parse with fallback — OpenAI sometimes wraps JSON in ```json fences
 * even with response_format=json_object.
 */
export function parseOpenAIJson<T = unknown>(text: string): T | null {
  let s = text.trim();
  // Strip code fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}
