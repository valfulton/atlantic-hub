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
import { parseOpenAIJson } from '@/lib/llm/parse';
import { runLlm } from '@/lib/llm/router';
import { getSystemPrompt } from '@/lib/ai/prompt_registry';
import { INTAKE_KEYS, INTAKE_GROUPS } from '@/lib/client/intake_fields';
import { getBriefPayload } from '@/lib/client/brief_store';
import { insertAuditSnapshot } from '@/lib/client/audit_snapshots';
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

/** (val 2026-06-07) Per-page health summary returned in suggestIntakeFromSite
 *  results so val sees what got read vs what was broken. */
export interface PageFetchHealth {
  url: string;
  finalUrl: string;
  status: number;
  bytes: number;
  textChars: number;
  /** 'ok' = page rendered with meaningful HTML text.
   *  'thin' = HTML returned but <200 chars of readable text (likely JS-rendered SPA).
   *  'redirected' = fetch followed redirects to a different origin (suspicious).
   *  'broken' = non-2xx, network error, timeout. */
  health: 'ok' | 'thin' | 'redirected' | 'broken';
  note: string | null;
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

// ---------------------------------------------------------------------------
// (val 2026-06-07) Multi-page auto-scrape — discover same-origin subpages from
// the homepage nav, fetch up to N additional pages, concatenate readable text
// across them, run ONE LLM pass. One click does what previously required val
// to paste /about, /services, /contact separately.
// ---------------------------------------------------------------------------

/** Subpath patterns we'll follow if discovered in the homepage. Ordered by
 *  marketing-page yield — about + services + products historically yield the
 *  intake fields the homepage alone can't fill (founder story, ICP, proof). */
const SUBPAGE_PATTERNS = [
  /^\/?(about|about-us|our-story|story|who-we-are|company|team|leadership)/i,
  /^\/?(services|what-we-do|solutions|capabilities|offerings|products|work)/i,
  /^\/?(case-studies|portfolio|results|clients|customers|testimonials|press|news)/i,
  /^\/?(contact|locations|where-we-work)/i
];

const MAX_SUBPAGES = 4;     // cap so a sprawling site doesn't burn the whole budget
const PER_PAGE_TEXT_CAP = 5000;  // chars per page when blending — keeps total under MAX_TEXT_CHARS

/**
 * Discover same-origin subpage URLs from the homepage HTML. Scans <a href>
 * targets, keeps href values matching SUBPAGE_PATTERNS, normalizes to absolute
 * URLs, dedupes, and caps at MAX_SUBPAGES. Returns ordered by pattern priority
 * so high-yield pages (about, services) win when the cap bites.
 */
export function discoverSubpages(html: string, baseUrl: string): string[] {
  let baseOrigin: string;
  try {
    baseOrigin = new URL(baseUrl).origin;
  } catch {
    return [];
  }
  // Match all <a href="..."> (and 'single quote' or unquoted variants).
  const hrefMatches = html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi);
  const byPriority: Array<{ url: string; rank: number }> = [];
  const seen = new Set<string>();
  for (const m of hrefMatches) {
    const raw = (m[1] || m[2] || m[3] || '').trim();
    if (!raw) continue;
    if (raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) continue;
    let absolute: string;
    try {
      absolute = new URL(raw, baseUrl).href;
    } catch { continue; }
    if (!absolute.startsWith(baseOrigin)) continue; // same-origin only
    if (absolute === baseUrl || absolute === baseUrl + '/') continue; // skip homepage self-link
    if (seen.has(absolute)) continue;
    let pathOnly: string;
    try { pathOnly = new URL(absolute).pathname; } catch { continue; }
    // Skip obvious non-content paths.
    if (/\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|css|js|xml|json)(\?|$)/i.test(pathOnly)) continue;
    // Match against priority patterns.
    for (let i = 0; i < SUBPAGE_PATTERNS.length; i++) {
      if (SUBPAGE_PATTERNS[i].test(pathOnly)) {
        byPriority.push({ url: absolute, rank: i });
        seen.add(absolute);
        break;
      }
    }
  }
  byPriority.sort((a, b) => a.rank - b.rank);
  return byPriority.slice(0, MAX_SUBPAGES).map((x) => x.url);
}

export interface MultiPageIntakeFillResult extends IntakeFillSuggestion {
  /** URLs that were actually fetched + included in the LLM blend. */
  pagesFetched: string[];
  /** URLs that were discovered but skipped (fetch failed or empty). */
  pagesSkipped: Array<{ url: string; reason: string }>;
  /** (val 2026-06-07) Per-page health: status, bytes, ok/thin/redirected/broken,
   *  short note. Surfaced in the operator panel so val sees "/contact 404",
   *  "/about JS-only", etc. without inspecting logs. */
  pageHealth: PageFetchHealth[];
  /** Plain-English website audit — weaknesses, missing pages, CTA quality,
   *  social proof, contact clarity. Drafted by a separate LLM pass over the
   *  same blended text so it doesn't dilute the intake-fill prompt. Empty
   *  string when the audit failed or the prompt isn't seeded yet. */
  websiteNotes: string;
  /** How the discovery happened: 'llm' = LLM-pick used, 'regex' = hardcoded
   *  pattern list (LLM-pick failed or returned nothing), 'none' = no
   *  subpages found at all. */
  discoveryMode: 'llm' | 'regex' | 'none';
}

/**
 * (val 2026-06-07) Extract every same-origin <a href> from the homepage and
 * return them as { href, text } pairs so the LLM picker has context. Returns
 * up to 60 pairs ordered by appearance — header / footer / body all included.
 */
function extractNavLinks(html: string, baseUrl: string): Array<{ url: string; label: string }> {
  let origin: string;
  try { origin = new URL(baseUrl).origin; } catch { return []; }
  const seen = new Set<string>();
  const out: Array<{ url: string; label: string }> = [];
  // Match <a ... href=... > LABEL </a> — robust to attribute order + casing.
  const matches = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi);
  for (const m of matches) {
    if (out.length >= 60) break;
    const attrs = m[1] || '';
    const labelHtml = m[2] || '';
    const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    const rawHref = (hrefMatch?.[1] || hrefMatch?.[2] || hrefMatch?.[3] || '').trim();
    if (!rawHref) continue;
    if (/^(#|mailto:|tel:|javascript:)/i.test(rawHref)) continue;
    let absolute: string;
    try { absolute = new URL(rawHref, baseUrl).href; } catch { continue; }
    if (!absolute.startsWith(origin)) continue;
    if (absolute === baseUrl || absolute === baseUrl + '/') continue;
    let pathOnly: string;
    try { pathOnly = new URL(absolute).pathname; } catch { continue; }
    if (/\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|css|js|xml|json)(\?|$)/i.test(pathOnly)) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    // Strip the label's HTML + collapse whitespace.
    const label = labelHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    out.push({ url: absolute, label: label || pathOnly });
  }
  return out;
}

/**
 * (val 2026-06-07) LLM-pick: hand the homepage's nav links to the model and
 * ask which 3-4 are most likely to carry brand info (about / services /
 * leadership / contact / case studies). Returns the picked URLs. Falls back
 * to the hardcoded regex discovery on failure.
 *
 * Cost: ~$0.001 extra per scrape. Worth it because clients use non-standard
 * paths (e.g. circaenergy.com has /residential, /commercial — patterns the
 * regex doesn't catch).
 */
export async function pickSubpagesWithLlm(args: {
  homepageHtml: string;
  homepageUrl: string;
  brandHint?: string | null;
  clientId?: number | null;
}): Promise<{ urls: string[]; mode: 'llm' | 'regex' | 'none' }> {
  const links = extractNavLinks(args.homepageHtml, args.homepageUrl);
  if (links.length === 0) return { urls: [], mode: 'none' };

  // If we have fewer candidates than the cap, skip the LLM call — just take them all.
  if (links.length <= MAX_SUBPAGES) {
    return { urls: links.map((l) => l.url), mode: 'llm' };
  }

  // Build a compact link table for the LLM.
  const linkTable = links
    .map((l, i) => `${i + 1}. ${new URL(l.url).pathname} — "${l.label}"`)
    .join('\n');

  const systemPrompt =
    'You are picking which subpages of a marketing website are most likely to contain ' +
    'concrete business information (founder/team, services/products, case studies, contact, ' +
    'and any pages whose names imply core capability — e.g. /residential, /commercial, ' +
    '/how-it-works). Skip blog posts, news items, individual product pages with date-stamped ' +
    'URLs, login pages, and policy pages (privacy, terms). Return JSON ONLY: ' +
    '{"picks": [3-4 path strings from the numbered list]}.';
  const userPrompt = [
    args.brandHint ? `BRAND: ${args.brandHint}` : '',
    `HOMEPAGE: ${args.homepageUrl}`,
    `LINKS (numbered):`,
    linkTable,
    ``,
    `Pick 3-4 path strings (NOT numbers) that are most likely to carry brand info. JSON only.`
  ].filter(Boolean).join('\n');

  try {
    const completion = await runLlm({
      taskKind: 'intake_web_fill',
      clientId: args.clientId ?? null,
      note: `subpage_pick · ${args.brandHint ?? args.homepageUrl.slice(0, 60)}`,
      prompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`,
      cacheKeyExtras: [args.homepageUrl, 'subpage_pick_v1'],
      temperature: 0.1,
      maxTokens: 300,
      json: true
    });
    const parsed = parseOpenAIJson<{ picks?: unknown }>(completion.text);
    const picks = Array.isArray(parsed?.picks) ? parsed!.picks : [];
    const wantedPaths = new Set(
      picks
        .filter((p): p is string => typeof p === 'string')
        .map((p) => p.trim())
        .filter(Boolean)
    );
    const matched = links
      .filter((l) => {
        try { return wantedPaths.has(new URL(l.url).pathname); } catch { return false; }
      })
      .slice(0, MAX_SUBPAGES)
      .map((l) => l.url);
    if (matched.length > 0) return { urls: matched, mode: 'llm' };
  } catch {
    // Fall through to regex fallback.
  }
  // Fallback: the hardcoded SUBPAGE_PATTERNS list.
  const regexPicks = discoverSubpages(args.homepageHtml, args.homepageUrl);
  return { urls: regexPicks, mode: regexPicks.length > 0 ? 'regex' : 'none' };
}

/**
 * (val 2026-06-07) Website audit pass. Reads the same blended page text and
 * produces a plain-English readout of weaknesses + opportunities — CTAs, hero
 * strength, missing pages, social proof, contact clarity, mobile / JS-rendered
 * concerns. Becomes a tangible deliverable val can hand the client + the
 * groundwork for selling web-rebuild engagements.
 *
 * Runs in parallel with the intake-fill LLM call so total wall time stays the
 * same. Costs one extra small LLM call. Fails open: empty string on error so
 * the intake fill keeps working.
 */
export async function auditWebsite(args: {
  blendedText: string;
  homepageUrl: string;
  brandHint?: string | null;
  industryHint?: string | null;
  clientId?: number | null;
  pageHealth: PageFetchHealth[];
}): Promise<string> {
  if (!args.blendedText || args.blendedText.length < 200) return '';
  const healthLine = args.pageHealth
    .map((p) => `${new URL(p.url).pathname} (HTTP ${p.status}, ${p.textChars} chars, health=${p.health}${p.note ? `, note=${p.note}` : ''})`)
    .join('\n  ');
  // (#509) Registered prompt at /admin/av/prompts → 'website_audit'. The lib
  // calls getSystemPrompt() which returns the editable version when present
  // and falls back to WEBSITE_AUDIT_DEFAULT inside the registry. We no longer
  // carry an inline default here — single source of truth in prompt_registry.
  const systemPrompt = await getSystemPrompt('website_audit');
  try {
    const completion = await runLlm({
      taskKind: 'intake_web_fill',
      clientId: args.clientId ?? null,
      note: `website_audit · ${args.brandHint ?? args.homepageUrl.slice(0, 60)}`,
      prompt:
        `SYSTEM:\n${systemPrompt}\n\nUSER:\nBRAND: ${args.brandHint ?? '(unknown)'}\n` +
        `INDUSTRY: ${args.industryHint ?? '(unknown — write industry-neutral but flag this gap)'}\n` +
        `HOMEPAGE: ${args.homepageUrl}\nPAGE_HEALTH:\n  ${healthLine}\n\nBLENDED_PAGE_TEXT:\n${args.blendedText}`,
      cacheKeyExtras: [
        args.homepageUrl,
        'website_audit_v3',
        args.industryHint ?? '',
        systemPrompt.slice(0, 200)
      ],
      temperature: 0.3,
      maxTokens: 1400
    });
    return completion.text.trim().slice(0, 6000);
  } catch {
    return '';
  }
}

/**
 * Multi-page version of suggestIntakeFromUrl. Fetches the homepage, discovers
 * up to MAX_SUBPAGES same-origin marketing subpages, fetches each (best-effort
 * — one failure doesn't tank the whole run), concatenates readable text, and
 * runs ONE LLM pass over the blend so the model sees a fuller picture of the
 * brand. Cost stays at ONE LLM call regardless of page count.
 *
 * Operator-typed values still win at merge time downstream — this lib never
 * writes to the DB.
 */
export async function suggestIntakeFromSite(args: {
  url: string;
  brandHint?: string | null;
  clientId?: number | null;
}): Promise<MultiPageIntakeFillResult> {
  const homepageUrl = args.url.trim();
  if (!isHttpUrl(homepageUrl)) {
    throw new IntakeWebFetchError(400, 'URL must be http(s) and a well-formed origin.');
  }
  const started = Date.now();

  // 1. Fetch homepage
  let home: { html: string; finalUrl: string; bytes: number };
  try {
    home = await fetchPage(homepageUrl);
  } catch (err) {
    await logEvent({
      eventType: 'intake.web_fill.fetch_failed',
      source: 'intake_filler',
      status: 'failure',
      errorMessage: (err as Error).message,
      payload: { url: homepageUrl, multi: true }
    });
    throw err;
  }

  // 2. Pick subpages — LLM-pick (smarter, costs ~$0.001) with regex fallback.
  const picked = await pickSubpagesWithLlm({
    homepageHtml: home.html,
    homepageUrl: home.finalUrl,
    brandHint: args.brandHint,
    clientId: args.clientId
  });
  const discoveryMode = picked.mode;
  const subpageUrls = picked.urls;

  // 3. Fetch each subpage with health tracking. Best-effort: skip failures.
  const homeText = htmlToText(home.html).slice(0, PER_PAGE_TEXT_CAP);
  const homeHealth: PageFetchHealth = {
    url: home.finalUrl,
    finalUrl: home.finalUrl,
    status: 200,
    bytes: home.bytes,
    textChars: homeText.length,
    health: homeText.length < 200 ? 'thin' : 'ok',
    note: homeText.length < 200 ? 'Homepage is JS-rendered or unusually thin — operator should check' : null
  };
  const pagesFetched: string[] = [home.finalUrl];
  const pagesSkipped: Array<{ url: string; reason: string }> = [];
  const pageHealth: PageFetchHealth[] = [homeHealth];
  const pageTexts: Array<{ url: string; text: string }> = [
    { url: home.finalUrl, text: homeText }
  ];
  let totalBytes = home.bytes;
  for (const subUrl of subpageUrls) {
    try {
      const sub = await fetchPage(subUrl);
      const text = htmlToText(sub.html).slice(0, PER_PAGE_TEXT_CAP);
      const subHealth: PageFetchHealth = {
        url: subUrl,
        finalUrl: sub.finalUrl,
        status: 200,
        bytes: sub.bytes,
        textChars: text.length,
        health: text.length < 100 ? 'thin' : (sub.finalUrl !== subUrl ? 'redirected' : 'ok'),
        note: text.length < 100 ? 'JS-rendered or empty body' : (sub.finalUrl !== subUrl ? `Redirected to ${sub.finalUrl}` : null)
      };
      pageHealth.push(subHealth);
      if (text.length < 100) {
        pagesSkipped.push({ url: subUrl, reason: 'too-thin' });
        continue;
      }
      pagesFetched.push(sub.finalUrl);
      pageTexts.push({ url: sub.finalUrl, text });
      totalBytes += sub.bytes;
    } catch (err) {
      const msg = (err as Error).message.slice(0, 120);
      const status = err instanceof IntakeWebFetchError ? err.statusCode : 0;
      pageHealth.push({
        url: subUrl,
        finalUrl: subUrl,
        status,
        bytes: 0,
        textChars: 0,
        health: 'broken',
        note: msg
      });
      pagesSkipped.push({ url: subUrl, reason: msg });
    }
  }

  // 4. Blend into one prompt (page-labeled so the model can attribute statements).
  let blended = pageTexts.map((p, i) => `[PAGE_${i + 1}] ${p.url}\n${p.text}`).join('\n\n---\n\n');
  if (blended.length > MAX_TEXT_CHARS) blended = blended.slice(0, MAX_TEXT_CHARS);

  // 4b. Pull INDUSTRY from the brief if we have a clientId. Threaded into the
  // audit prompt so feedback is industry-specific (solar buyers vs collections
  // creditors vs real estate vs lending) instead of generic web-design advice.
  // (#509)
  let industryHint: string | null = null;
  if (args.clientId) {
    try {
      const brief = (await getBriefPayload('av', args.clientId)) ?? {};
      const candidate = (brief as Record<string, unknown>).industry;
      if (typeof candidate === 'string' && candidate.trim()) {
        industryHint = candidate.trim().slice(0, 200);
      }
    } catch { /* non-fatal — audit still runs, just without industry context */ }
  }

  // 5. Run intake fill + website audit in PARALLEL. One blends the intake
  // fields; the other produces the plain-English website readout. Cost is
  // 2 LLM calls but wall time stays at 1 call's duration.
  const systemPrompt = await getSystemPrompt('intake_web_filler');
  const userPrompt = [
    args.brandHint ? `BRAND_NAME_HINT: ${args.brandHint}` : '',
    `SOURCE_HOMEPAGE: ${home.finalUrl}`,
    `PAGES_BLENDED: ${pagesFetched.length} (${pagesFetched.join(', ')})`,
    ``,
    `CANONICAL_INTAKE_FIELDS (use these keys exactly; LEAVE BLANK any field the pages do not actually support):`,
    describeFieldsForPrompt(),
    `BLENDED_PAGE_TEXT (concatenated across ${pagesFetched.length} pages of the site):`,
    blended
  ].filter((s) => s.length > 0).join('\n');

  const sysPromptForKey = systemPrompt.slice(0, 200);
  const [completion, websiteNotes] = await Promise.all([
    runLlm({
      taskKind: 'intake_web_fill',
      clientId: args.clientId ?? null,
      note: `intake_web_fill MULTI · ${args.brandHint ?? home.finalUrl.slice(0, 60)} · ${pagesFetched.length} pages`,
      prompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`,
      cacheKeyExtras: [home.finalUrl, pagesFetched.join('|'), args.brandHint ?? '', sysPromptForKey],
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      json: true
    }),
    auditWebsite({
      blendedText: blended,
      homepageUrl: home.finalUrl,
      brandHint: args.brandHint,
      industryHint,
      clientId: args.clientId,
      pageHealth
    })
  ]);

  const parsed = parseOpenAIJson<{ summary?: string; suggestions?: Record<string, unknown> }>(completion.text);
  if (!parsed || typeof parsed.suggestions !== 'object' || parsed.suggestions === null) {
    throw new Error('Model returned malformed JSON for multi-page intake suggestions.');
  }

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
    eventType: 'intake.web_fill.suggested_multi',
    source: 'llm_router',
    executionTimeMs: Date.now() - started,
    payload: {
      homepage: home.finalUrl,
      pages_fetched: pagesFetched,
      pages_skipped: pagesSkipped,
      html_bytes: totalBytes,
      text_chars: blended.length,
      suggested_keys: Object.keys(suggestions),
      tokens: completion.inputTokens + completion.outputTokens,
      cost_microcents: completion.costMicrocents,
      cost_source: completion.source,
      industry_hint: industryHint,
      audit_chars: websiteNotes.length,
      page_health_summary: pageHealth.map((p) => ({ url: p.url, health: p.health, chars: p.textChars }))
    }
  });

  // (#512) Persist a snapshot of the audit + parsed scores so the operator
  // client page can render a KPI strip and the cross-client roll-up can
  // surface weakest sites. Non-fatal: insert returns null on any DB error.
  if (websiteNotes && websiteNotes.length > 100) {
    void insertAuditSnapshot({
      clientId: args.clientId ?? null,
      homepageUrl: home.finalUrl,
      industryHint,
      auditMarkdown: websiteNotes,
      pagesReached: pageHealth.length,
      pagesFlagged: pageHealth.filter((p) => p.health !== 'ok').length,
      discoveryMode,
      costMicrocents: completion.costMicrocents
    });
  }

  return {
    suggestions,
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 600) : '',
    fetchedUrl: home.finalUrl,
    htmlBytes: totalBytes,
    textChars: blended.length,
    tokensUsed: completion.inputTokens + completion.outputTokens,
    model: completion.model,
    costMicrocents: completion.costMicrocents,
    costSource: completion.source,
    pagesFetched,
    pagesSkipped,
    pageHealth,
    websiteNotes,
    discoveryMode
  };
}
