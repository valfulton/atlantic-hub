/**
 * lib/client/brand_kit_extractor.ts  (#208)
 *
 * Given a client's public website, extract a structured brand kit that
 * commercials / social cards / blog headers / email signatures will use to
 * brand assets in their real visual identity — without val typing colors by
 * hand on every onboard.
 *
 * Distinct from intake_web_filler (#235), which reads the same page for the
 * 51 intake QUESTIONS (about who they sell to, what they say). This extractor
 * is targeted at the VISUAL kit: colors, logo candidates, typography vibe.
 *
 * Strategy:
 *   1. Fetch the page with the same browser-pretend User-Agent as #235.
 *   2. Pull a few lightweight signals out of the raw HTML BEFORE the LLM call:
 *        - Inline <style> color hex codes
 *        - og:image (best logo/hero candidate)
 *        - apple-touch-icon / favicon (logo fallback)
 *        - <link rel="stylesheet"> hrefs (which fonts they import from Google Fonts)
 *        - <img> tags in <header> regions with "logo" alt/class
 *      These are deterministic signals the LLM can ground on instead of
 *      having to guess from prose alone.
 *   3. Run an LLM with the cleaned plain text + the deterministic signals →
 *      return a structured brand kit + 1-sentence reasoning.
 *
 * Preview-first, never writes. The route handler applies via brief_store.
 */
import { parseOpenAIJson } from '@/lib/llm/parse';
import { runLlm } from '@/lib/llm/router';
import { getSystemPrompt } from '@/lib/ai/prompt_registry';
import { logEvent } from '@/lib/events/log';

const FETCH_TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 1_500_000;
const MAX_TEXT_CHARS = 10_000;
const TEMPERATURE = 0.2;
const MAX_TOKENS = 700;
// (#361) Model is decided by lib/llm/types.ts TASK_MODEL['brand_kit_extract'].
// Default today: openai:gpt-4o-mini. Swap to google:gemini-1.5-flash for ~95%
// cost savings (no code change needed -- change the one line in types.ts).

export class BrandKitFetchError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'BrandKitFetchError';
  }
}

export interface BrandKitSuggestion {
  /** Hex codes (with #), 0-4 of them, most prominent first. */
  colors: string[];
  /** Best-guess logo URL from og:image / header img / apple-touch-icon. */
  logoUrl: string | null;
  /** All logo candidates surfaced from HTML so the operator can pick. */
  logoCandidates: string[];
  /** Single human-readable aesthetic ("modern minimalist", "luxury serif"). */
  aesthetic: string | null;
  /** Typography family pulled from Google Fonts import or LLM read. */
  typography: string | null;
  /** Operator-facing summary of how the read went. */
  reasoning: string;
  /** (#509) Operator-facing VERDICT — opinionated read on whether the logo
   *  is dated, palette is on-brand for the industry, typography is intentional
   *  vs default. Used as sales ammo on calls ("Their logo reads 2008 Web 2.0
   *  gloss — we'd refresh the mark and modernize the palette."). Empty string
   *  if the LLM didn't produce one. */
  verdict: string;
  /** Bookkeeping. */
  fetchedUrl: string;
  htmlBytes: number;
  tokensUsed: number;
  model: string;
  /** (#361) Cost accounting from the router. costMicrocents = 0 + source='cache' = free reuse. */
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

/** Same fetch behavior as intake_web_filler -- pretend-browser headers + cap. */
async function fetchPage(url: string): Promise<{ html: string; finalUrl: string; bytes: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Atlantic-Vine-BrandKit/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: ctrl.signal
    });
    if (!res.ok) throw new BrandKitFetchError(res.status, `HTTP ${res.status} from ${url}`);
    const ct = res.headers.get('content-type') || '';
    if (!ct.toLowerCase().includes('html')) {
      throw new BrandKitFetchError(415, `Not an HTML page (content-type: ${ct || 'unknown'})`);
    }
    const reader = res.body?.getReader();
    if (!reader) {
      const text = (await res.text()).slice(0, MAX_HTML_BYTES);
      return { html: text, finalUrl: res.url || url, bytes: text.length };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
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

/** Resolve a possibly-relative URL against the page's final URL. */
function resolveUrl(maybe: string, base: string): string | null {
  if (!maybe) return null;
  try {
    return new URL(maybe, base).toString();
  } catch {
    return null;
  }
}

/**
 * Deterministic pass over the raw HTML. Pulls anything the LLM shouldn't have
 * to guess from prose. Returns small structured payload + cleaned text body.
 */
interface HtmlSignals {
  inlineColors: string[];        // hex codes found in inline <style> blocks
  ogImage: string | null;
  appleTouchIcon: string | null;
  favicon: string | null;
  headerImages: string[];        // <img src> from <header>/<nav> with logo hints
  googleFonts: string[];         // family names parsed from Google Fonts <link>
  cleanedText: string;
}

function extractHtmlSignals(html: string, baseUrl: string): HtmlSignals {
  // Inline <style> hex colors. We only consider 6-char hex with a leading #.
  // Filter to the colors that ACTUALLY repeat (signal vs noise).
  const inlineStyleBlocks = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)).map((m) => m[1]);
  const allHex: Record<string, number> = {};
  for (const block of inlineStyleBlocks) {
    const hits = block.match(/#[0-9a-fA-F]{6}\b/g) || [];
    for (const h of hits) {
      const norm = h.toLowerCase();
      // Skip pure black + pure white -- they're almost always page neutrals,
      // not brand colors. (The LLM can re-include if context demands.)
      if (norm === '#000000' || norm === '#ffffff') continue;
      allHex[norm] = (allHex[norm] ?? 0) + 1;
    }
  }
  const inlineColors = Object.entries(allHex)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([h]) => h);

  // OG image, apple-touch-icon, favicon.
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const ogImage = ogMatch ? resolveUrl(ogMatch[1], baseUrl) : null;

  const appleMatch = html.match(/<link[^>]+rel=["'](?:apple-touch-icon[^"']*)["'][^>]+href=["']([^"']+)["']/i);
  const appleTouchIcon = appleMatch ? resolveUrl(appleMatch[1], baseUrl) : null;

  const faviconMatch = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i);
  const favicon = faviconMatch ? resolveUrl(faviconMatch[1], baseUrl) : null;

  // <img> tags inside <header>, <nav>, or with "logo" in class/alt.
  const headerImages: string[] = [];
  const headerBlocks = Array.from(html.matchAll(/<(?:header|nav)[^>]*>([\s\S]*?)<\/(?:header|nav)>/gi)).map((m) => m[1]);
  for (const block of headerBlocks) {
    const imgs = Array.from(block.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi));
    for (const m of imgs) {
      const url = resolveUrl(m[1], baseUrl);
      if (url) headerImages.push(url);
    }
  }
  // Also pick <img> anywhere whose class/alt contains "logo".
  const logoHintImgs = Array.from(html.matchAll(/<img[^>]*(?:class|alt)=["'][^"']*logo[^"']*["'][^>]*src=["']([^"']+)["']/gi))
    .concat(Array.from(html.matchAll(/<img[^>]*src=["']([^"']+)["'][^>]*(?:class|alt)=["'][^"']*logo[^"']*["']/gi)));
  for (const m of logoHintImgs) {
    const url = resolveUrl(m[1], baseUrl);
    if (url && !headerImages.includes(url)) headerImages.push(url);
  }

  // Google Fonts: extract family names from <link> hrefs.
  const fontHrefs = Array.from(html.matchAll(/<link[^>]+href=["'](https:\/\/fonts\.googleapis\.com\/[^"']+)["']/gi))
    .map((m) => m[1]);
  const googleFonts: string[] = [];
  for (const href of fontHrefs) {
    const families = Array.from(href.matchAll(/family=([^&:]+)/g)).map((m) => decodeURIComponent(m[1]).replace(/\+/g, ' '));
    for (const f of families) {
      const clean = f.trim();
      if (clean && !googleFonts.includes(clean)) googleFonts.push(clean);
    }
  }

  // Cleaned text body so the LLM can read the aesthetic vibe (descriptive
  // language often signals "luxury" / "minimalist" / "playful" / etc.).
  let cleaned = html;
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  cleaned = cleaned.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');
  cleaned = cleaned.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
  cleaned = cleaned.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);

  return {
    inlineColors,
    ogImage,
    appleTouchIcon,
    favicon,
    headerImages: headerImages.slice(0, 6),
    googleFonts,
    cleanedText: cleaned
  };
}

function pickLogoCandidate(signals: HtmlSignals): { primary: string | null; candidates: string[] } {
  // Priority: og:image (curated by site owner), header logo img, apple-touch-icon, favicon.
  const candidates: string[] = [];
  if (signals.ogImage) candidates.push(signals.ogImage);
  for (const h of signals.headerImages) if (!candidates.includes(h)) candidates.push(h);
  if (signals.appleTouchIcon && !candidates.includes(signals.appleTouchIcon)) candidates.push(signals.appleTouchIcon);
  if (signals.favicon && !candidates.includes(signals.favicon)) candidates.push(signals.favicon);
  return { primary: candidates[0] ?? null, candidates };
}

/**
 * Fetch a URL + extract a structured brand kit. Throws on fetch failure;
 * returns a result with empty fields if the LLM has nothing to add.
 */
export async function extractBrandKitFromUrl(args: {
  url: string;
  brandHint?: string | null;
  /** (#361) When provided, the LLM call gets tagged with this client_id in
   *  llm_call_log so per-client spend reporting works. */
  clientId?: number | null;
}): Promise<BrandKitSuggestion> {
  const url = args.url.trim();
  if (!isHttpUrl(url)) throw new BrandKitFetchError(400, 'URL must be http(s) and well-formed.');

  const started = Date.now();
  let page: { html: string; finalUrl: string; bytes: number };
  try {
    page = await fetchPage(url);
  } catch (err) {
    await logEvent({
      eventType: 'brand_kit.fetch_failed',
      source: 'brand_kit',
      status: 'failure',
      errorMessage: (err as Error).message,
      payload: { url }
    });
    throw err;
  }

  const signals = extractHtmlSignals(page.html, page.finalUrl);
  const { primary: logoPrimary, candidates: logoCandidates } = pickLogoCandidate(signals);

  const systemPrompt = await getSystemPrompt('brand_kit_extractor');
  const userPrompt = [
    args.brandHint ? `BRAND_NAME_HINT: ${args.brandHint}` : '',
    `SOURCE_URL: ${page.finalUrl}`,
    ``,
    `DETERMINISTIC_SIGNALS (extracted from raw HTML, ground your answer in these):`,
    `  REPEATED_INLINE_COLORS (most-used hex codes, excluding pure black/white): ${signals.inlineColors.join(', ') || '(none found)'}`,
    `  GOOGLE_FONTS_IMPORTED: ${signals.googleFonts.join(', ') || '(none)'}`,
    `  LOGO_CANDIDATES (operator will pick one): ${logoCandidates.slice(0, 4).join(' | ') || '(none)'}`,
    ``,
    `PAGE_TEXT (aesthetic/vibe cues only — don't fabricate facts):`,
    signals.cleanedText.slice(0, 5000),
    ``,
    `Now produce the JSON object.`
  ].filter(Boolean).join('\n');

  let completion;
  try {
    // (#361) Routes through OpenRouter when OPENROUTER_API_KEY is set; falls
    // back to direct OpenAI on transient OpenRouter errors for OpenAI models.
    // Cache keyed on URL + brandHint + system prompt version so re-runs on the
    // same URL within 7 days are free.
    const sysPromptForKey = systemPrompt.slice(0, 200);
    completion = await runLlm({
      taskKind: 'brand_kit_extract',
      clientId: args.clientId ?? null,
      note: `brand_kit · ${args.brandHint ?? page.finalUrl.slice(0, 60)}`,
      prompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`,
      cacheKeyExtras: [page.finalUrl, args.brandHint ?? '', sysPromptForKey],
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      json: true
    });
  } catch (err) {
    await logEvent({
      eventType: 'brand_kit.llm_failed',
      source: 'llm_router',
      status: 'failure',
      errorMessage: (err as Error).message,
      payload: { url: page.finalUrl }
    });
    throw err;
  }

  const parsed = parseOpenAIJson<{
    colors?: string[];
    logo_url?: string | null;
    aesthetic?: string | null;
    typography?: string | null;
    reasoning?: string;
    verdict?: string;
  }>(completion.text);

  if (!parsed) {
    await logEvent({
      eventType: 'brand_kit.parse_failed',
      source: 'openai',
      status: 'failure',
      payload: { url: page.finalUrl, raw_excerpt: completion.text.slice(0, 400) }
    });
    throw new Error('Model returned malformed JSON for brand kit.');
  }

  const HEX = /^#[0-9a-fA-F]{6}$/;
  const colors = Array.isArray(parsed.colors)
    ? parsed.colors
        .filter((c): c is string => typeof c === 'string')
        .map((c) => c.trim())
        .filter((c) => HEX.test(c))
        .slice(0, 4)
    : [];

  const result: BrandKitSuggestion = {
    colors,
    logoUrl: typeof parsed.logo_url === 'string' && parsed.logo_url.startsWith('http')
      ? parsed.logo_url.trim()
      : logoPrimary,
    logoCandidates,
    aesthetic: typeof parsed.aesthetic === 'string' && parsed.aesthetic.trim() ? parsed.aesthetic.trim().slice(0, 200) : null,
    typography: typeof parsed.typography === 'string' && parsed.typography.trim()
      ? parsed.typography.trim().slice(0, 200)
      : (signals.googleFonts[0] ?? null),
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 800) : '',
    verdict: typeof parsed.verdict === 'string' ? parsed.verdict.slice(0, 1200) : '',
    fetchedUrl: page.finalUrl,
    htmlBytes: page.bytes,
    tokensUsed: completion.inputTokens + completion.outputTokens,
    model: completion.model,
    costMicrocents: completion.costMicrocents,
    costSource: completion.source
  };

  await logEvent({
    eventType: 'brand_kit.suggested',
    source: 'llm_router',
    executionTimeMs: Date.now() - started,
    payload: {
      url: page.finalUrl,
      colors_count: result.colors.length,
      logo_found: !!result.logoUrl,
      logo_candidates: result.logoCandidates.length,
      tokens: result.tokensUsed,
      cost_microcents: result.costMicrocents,
      cost_source: result.costSource
    }
  });

  return result;
}
