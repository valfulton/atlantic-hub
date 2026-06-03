/**
 * lib/client/intake_web_filler.ts  (#235)
 *
 * Given a public URL, fetch it, extract readable text, and run an LLM pass
 * that drafts as many of the 51 canonical intake fields as the page actually
 * supports. The output is a partial intake payload the operator can preview
 * and apply.
 *
 * This is the "skip the SQL paste" path: instead of val running phpMyAdmin
 * for every new client, she clicks a button on their hub page, drops their
 * website URL, and the system drafts the intake from the public web.
 *
 * Design choices:
 *   - Single-page fetch. Multi-page crawl is a future iteration; this is the
 *     minimum useful version.
 *   - Plain HTML -> text extraction (strip tags, decode entities, collapse
 *     whitespace). Good enough for marketing pages.
 *   - Preview-first: the lib NEVER writes to the DB. It returns suggestions.
 *     The route handler does the merge after the operator approves.
 *   - Conservative: the LLM is told to LEAVE FIELDS BLANK rather than
 *     guess. Half-filled is better than wrong-filled — a wrong founder_story
 *     poisons every audit downstream.
 *   - The prompt is editable via the prompt_registry (key 'intake_web_filler')
 *     so val can sharpen it without a deploy.
 */
import { parseOpenAIJson } from '@/lib/openai/client';
import { runLlm } from '@/lib/llm/router';
import { getSystemPrompt } from '@/lib/ai/prompt_registry';
import { INTAKE_KEYS, INTAKE_GROUPS } from '@/lib/client/intake_fields';
import { logEvent } from '@/lib/events/log';

const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 1_500_000; // 1.5MB ceiling on the raw page
const MAX_TEXT_CHARS = 18_000;    // hard cap on what we send to the model
const TEMPERATURE = 0.2;
const MAX_TOKENS = 1500;
// (#361) Model decided by lib/llm/types.ts TASK_MODEL['intake_web_fill'].

export class IntakeWebFetchError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'IntakeWebFetchError';
  }
}

export interface IntakeFillSuggestion {
  /** Suggested intake payload, keyed by canonical intake field key. Only
   *  contains fields the LLM had real signal for; never includes a key with
   *  an empty value. */
  suggestions: Record<string, string>;
  /** Operator-facing summary of what the page was about, for the preview UI. */
  summary: string;
  /** The final URL that was fetched (after any redirects). */
  fetchedUrl: string;
  /** Bytes downloaded + characters of cleaned text actually sent to the model. */
  htmlBytes: number;
  textChars: number;
  /** LLM usage so val can keep an eye on cost. */
  tokensUsed: number;
  model: string;
  /** (#361) Cost accounting from the router. */
  costMicrocents: number;
  costSource: 'live' | 'cache';
}

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Pull readable text out of a raw HTML string. We drop <script>/<style> blocks
 * entirely, strip tags, decode the four common XML entities + numeric refs,
 * and collapse whitespace. Not a perfect parser -- it doesn't need to be; the
 * model is robust to noise -- but it does kill the obvious junk so we don't
 * send 1.5MB of CSS to OpenAI.
 */
function htmlToText(html: string): string {
  let s = html;
  // Drop scripts + styles (and anything inside <noscript>).
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  // Preserve some structure: turn <br> + close-block tags into newlines so the
  // model sees paragraph boundaries.
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n');
  // Strip the rest of the tags.
  s = s.replace(/<[^>]+>/g, ' ');
  // Decode the common entities. (Full entity decoding is overkill; we cover
  // the ones that actually break paragraph readability.)
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
  // Collapse whitespace -- keep newlines as paragraph separators.
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string; bytes: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        // Pretend to be a normal modern browser so anti-bot middleware
        // doesn't bounce us. Many marketing sites soft-block bare fetch.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Atlantic-Vine-Intake-Filler/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: ctrl.signal
    });
    if (!res.ok) {
      throw new IntakeWebFetchError(res.status, `HTTP ${res.status} from ${url}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.toLowerCase().includes('html')) {
      throw new IntakeWebFetchError(415, `Not an HTML page (content-type: ${ct || 'unknown'})`);
    }
    // Cap how much we read so a 50MB page doesn't OOM the function.
    const reader = res.body?.getReader();
    if (!reader) {
      const text = (await res.text()).slice(0, MAX_HTML_BYTES);
      return { html: text, finalUrl: res.url || url, bytes: text.length };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    // Read until ceiling or end of stream.
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        chunks.push(value);
        if (total >= MAX_HTML_BYTES) break;
      }
    }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
    const html = new TextDecoder('utf-8').decode(merged);
    return { html, finalUrl: res.url || url, bytes: total };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Build the operator-facing list of field labels we want the LLM to consider.
 * Keeps the prompt grounded in the canonical 51 -- so additions to
 * INTAKE_GROUPS are picked up automatically.
 */
function describeFieldsForPrompt(): string {
  const lines: string[] = [];
  for (const g of INTAKE_GROUPS) {
    lines.push(`# ${g.group}`);
    for (const f of g.fields) {
      const hint = f.hint ? ` — ${f.hint}` : '';
      lines.push(`- ${f.key}: ${f.label}${hint}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Fetch a URL, extract text, and run the LLM to draft an intake payload.
 * Throws on fetch failure / OpenAI failure; never silently returns junk.
 */
export async function suggestIntakeFromUrl(args: {
  url: string;
  brandHint?: string | null;
  /** (#361) Tags the LLM call with this client_id in llm_call_log so
   *  per-client spend reporting works end-to-end. */
  clientId?: number | null;
}): Promise<IntakeFillSuggestion> {
  const url = args.url.trim();
  if (!isHttpUrl(url)) {
    throw new IntakeWebFetchError(400, 'URL must be http(s) and a well-formed origin.');
  }

  const started = Date.now();
  let page: { html: string; finalUrl: string; bytes: number };
  try {
    page = await fetchPage(url);
  } catch (err) {
    await logEvent({
      eventType: 'intake.web_fill.fetch_failed',
      source: 'intake_filler',
      status: 'failure',
      errorMessage: (err as Error).message,
      payload: { url }
    });
    throw err;
  }

  const cleaned = htmlToText(page.html).slice(0, MAX_TEXT_CHARS);
  if (cleaned.length < 200) {
    throw new IntakeWebFetchError(
      422,
      `Only got ${cleaned.length} chars of readable text. The site may be client-rendered (SPA) — try a different URL with more visible copy.`
    );
  }

  const systemPrompt = await getSystemPrompt('intake_web_filler');
  const userPrompt = [
    args.brandHint ? `BRAND_NAME_HINT: ${args.brandHint}` : '',
    `SOURCE_URL: ${page.finalUrl}`,
    ``,
    `CANONICAL_INTAKE_FIELDS (use these keys exactly; LEAVE BLANK any field the page does not actually support):`,
    describeFieldsForPrompt(),
    `PAGE_TEXT (extracted from ${page.finalUrl}):`,
    cleaned
  ]
    .filter((s) => s.length > 0)
    .join('\n');

  let completion;
  try {
    // (#361) Routed via OpenRouter when OPENROUTER_API_KEY is set; transient
    // OpenRouter errors auto-fall-back to direct OpenAI for OpenAI models.
    // Cache key includes URL + brandHint + a prompt-version hash so re-runs
    // on the same URL within 7 days are free.
    const sysPromptForKey = systemPrompt.slice(0, 200);
    completion = await runLlm({
      taskKind: 'intake_web_fill',
      clientId: args.clientId ?? null,
      note: `intake_web_fill · ${args.brandHint ?? page.finalUrl.slice(0, 60)}`,
      prompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`,
      cacheKeyExtras: [page.finalUrl, args.brandHint ?? '', sysPromptForKey],
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      json: true
    });
  } catch (err) {
    await logEvent({
      eventType: 'intake.web_fill.llm_failed',
      source: 'llm_router',
      status: 'failure',
      errorMessage: (err as Error).message,
      payload: { url: page.finalUrl }
    });
    throw err;
  }

  const parsed = parseOpenAIJson<{
    summary?: string;
    suggestions?: Record<string, unknown>;
  }>(completion.text);

  if (!parsed || typeof parsed.suggestions !== 'object' || parsed.suggestions === null) {
    await logEvent({
      eventType: 'intake.web_fill.llm_parse_failed',
      source: 'openai',
      status: 'failure',
      payload: { url: page.finalUrl, raw_excerpt: completion.text.slice(0, 400) }
    });
    throw new Error('Model returned malformed JSON for intake suggestions.');
  }

  // Filter to canonical keys + drop empty strings. The model occasionally
  // emits "" or null for fields it doesn't have signal on; we strip those so
  // the merge step downstream doesn't write blanks over real values.
  const allowed = new Set(INTAKE_KEYS);
  const suggestions: Record<string, string> = {};
  for (const [k, raw] of Object.entries(parsed.suggestions)) {
    if (!allowed.has(k)) continue;
    if (typeof raw !== 'string') continue;
    const v = raw.trim();
    if (!v) continue;
    suggestions[k] = v.slice(0, 4000);
  }

  await logEvent({
    eventType: 'intake.web_fill.suggested',
    source: 'llm_router',
    executionTimeMs: Date.now() - started,
    payload: {
      url: page.finalUrl,
      html_bytes: page.bytes,
      text_chars: cleaned.length,
      suggested_keys: Object.keys(suggestions),
      tokens: completion.inputTokens + completion.outputTokens,
      cost_microcents: completion.costMicrocents,
      cost_source: completion.source
    }
  });

  return {
    suggestions,
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 600) : '',
    fetchedUrl: page.finalUrl,
    htmlBytes: page.bytes,
    textChars: cleaned.length,
    tokensUsed: completion.inputTokens + completion.outputTokens,
    model: completion.model,
    costMicrocents: completion.costMicrocents,
    costSource: completion.source
  };
}
