/**
 * lib/av/prep_preflight.ts  (#358, val 2026-06-02)
 *
 * Free pre-flight checks for the Prep chain. Answers, WITHOUT firing any LLM:
 *   - Is the brand's website actually reachable + HTML + has real content?
 *   - Is the brief substantively populated enough to extract from?
 *
 * Used by:
 *   1. The "Check first" button — val sees readiness per step before spending.
 *   2. The Prep endpoint itself — broken steps are SKIPPED before the LLM is
 *      called, so a 404 URL never burns a token.
 *
 * Hard limits, by design:
 *   - 4s timeout per HTTP probe
 *   - 200 KB body cap (enough to count words + spot a real <body>)
 *   - Refuse non-public hosts (localhost / private IP / file://)
 *   - Never logs response bodies
 */

import { INTAKE_KEYS } from '@/lib/client/intake_fields';

const PROBE_TIMEOUT_MS = 4000;
const MAX_BYTES = 200 * 1024;
const MIN_WORDS_FOR_LLM = 80;   // anything less is a near-empty page; LLM call wasted
const MIN_BRIEF_FIELDS = 3;     // anything less and brief-based LLM steps run on garbage

export type StepReadiness =
  | { ok: true; reason?: never }
  | { ok: false; reason: string };

export interface PreflightReport {
  url: string | null;
  /** What the URL probe actually returned. Null when no URL was provided. */
  web: {
    reached: boolean;
    httpStatus: number | null;
    contentType: string | null;
    wordCount: number;
    failureReason: string | null;
  } | null;
  /** Brief signal — how many substantive fields are populated. */
  brief: {
    filledCount: number;
    enoughForLlm: boolean;
    /** (#516) Canonical-intake keys NOT yet filled. Surfaced in the UI so val
     *  can see at a glance which intake fields still need attention without
     *  clicking into Edit Full Intake. Capped to keep the response sane. */
    missingKeys: string[];
    totalKeys: number;
  };
  /** Has-intake check — are there any client_users with a real intake_payload? */
  hasIntake: boolean;
  /** Per-step readiness — drives skip logic in the Prep endpoint. */
  steps: {
    fill_intake: StepReadiness;
    brand_kit: StepReadiness;
    sharpen_icp: StepReadiness;
    extract_intel: StepReadiness;
    scrape_socials: StepReadiness;
  };
}

function isSafePublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return false;
  if (/^10\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (/^169\.254\./.test(host)) return false;
  return true;
}

/** Strip HTML tags + decode entities crudely; count words. */
function countWords(html: string): number {
  // Strip script/style first (they don't carry user-visible content).
  const cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter((w) => w.length > 1).length;
}

/** GET with strict timeout + byte cap. Returns the (truncated) text + meta. */
async function probeWeb(url: string): Promise<PreflightReport['web']> {
  if (!isSafePublicUrl(url)) {
    return { reached: false, httpStatus: null, contentType: null, wordCount: 0, failureReason: 'unsafe_url' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AtlanticVineBot/1.0; +https://atlanticandvine.com)',
        Accept: 'text/html,application/xhtml+xml'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    if (!resp.ok) {
      return {
        reached: false,
        httpStatus: resp.status,
        contentType: resp.headers.get('content-type'),
        wordCount: 0,
        failureReason: `http_${resp.status}`
      };
    }
    const ct = resp.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(ct)) {
      return { reached: true, httpStatus: resp.status, contentType: ct, wordCount: 0, failureReason: 'not_html' };
    }
    const reader = resp.body?.getReader();
    if (!reader) {
      return { reached: true, httpStatus: resp.status, contentType: ct, wordCount: 0, failureReason: 'no_body' };
    }
    let received = 0;
    let chunks = '';
    const decoder = new TextDecoder();
    while (received < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      chunks += decoder.decode(value, { stream: true });
    }
    try { await reader.cancel(); } catch { /* ignore */ }
    return {
      reached: true,
      httpStatus: resp.status,
      contentType: ct,
      wordCount: countWords(chunks),
      failureReason: null
    };
  } catch (e) {
    const reason = e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'fetch_error';
    return { reached: false, httpStatus: null, contentType: null, wordCount: 0, failureReason: reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Count canonical intake fields with a non-empty value. Reads against the
 * single source of truth in lib/client/intake_fields.ts — same fix as the
 * onboarding counter (#501): the old hardcoded camelCase list was fictional
 * and never matched the snake_case keys the intake form actually writes,
 * so the count was almost always 0-1.
 */
function countSubstantiveBriefFields(payload: Record<string, unknown> | null): {
  filledCount: number;
  missingKeys: string[];
} {
  if (!payload) {
    return { filledCount: 0, missingKeys: [...INTAKE_KEYS] };
  }
  let filledCount = 0;
  const missingKeys: string[] = [];
  for (const k of INTAKE_KEYS) {
    const v = (payload as Record<string, unknown>)[k];
    const filled = (typeof v === 'string' && v.trim().length > 0)
      || (Array.isArray(v) && v.length > 0);
    if (filled) filledCount += 1;
    else missingKeys.push(k);
  }
  return { filledCount, missingKeys };
}

/**
 * Run all the free checks. No LLM calls. No DB writes.
 *
 * The result is a per-step readiness object the Prep endpoint can use to
 * SKIP steps that would fail or produce garbage. Each step is independent —
 * a bad URL doesn't block brief-based steps, and a thin brief doesn't block
 * web-based ones.
 */
export async function runPrepPreflight(args: {
  url: string | null;
  briefPayload: Record<string, unknown> | null;
  hasIntakePayload: boolean;
  /** (#510 followup, val 2026-06-08) Count of social_targets already on file
   *  for this client. When > 0, scrape_socials is "already covered" — we no
   *  longer skip it for "no website on brief", since the work product (URLs)
   *  is already there. */
  socialsOnFile?: number;
}): Promise<PreflightReport> {
  const web = args.url ? await probeWeb(args.url) : null;
  const { filledCount, missingKeys } = countSubstantiveBriefFields(args.briefPayload);
  const enoughForLlm = filledCount >= MIN_BRIEF_FIELDS;

  const webOk = !!web && web.reached && !web.failureReason && web.wordCount >= MIN_WORDS_FOR_LLM;

  const steps: PreflightReport['steps'] = {
    fill_intake: webOk
      ? { ok: true }
      : { ok: false, reason: web == null ? 'no website on brief' : web.failureReason === null ? `page only has ${web.wordCount} words` : web.failureReason },
    brand_kit: webOk
      ? { ok: true }
      : { ok: false, reason: web == null ? 'no website on brief' : web.failureReason ?? `page only has ${web.wordCount} words` },
    sharpen_icp: enoughForLlm
      ? { ok: true }
      : { ok: false, reason: `only ${filledCount} brief field${filledCount === 1 ? '' : 's'} filled (need ${MIN_BRIEF_FIELDS}+)` },
    extract_intel: args.hasIntakePayload || enoughForLlm
      ? { ok: true }
      : { ok: false, reason: 'no intake payload yet' },
    // Scrape socials is free (regex only, no LLM). Already-on-file socials
    // count as "covered" — don't skip if val pre-populated them by hand or
    // they came in via an earlier scrape. URL only matters when 0 socials
    // are on file (we'd need to find some from somewhere).
    scrape_socials: (args.socialsOnFile && args.socialsOnFile > 0)
      ? { ok: true }
      : web && web.reached
        ? { ok: true }
        : { ok: false, reason: web == null ? 'no website on brief' : web.failureReason ?? 'unreachable' }
  };

  return {
    url: args.url,
    web,
    brief: {
      filledCount,
      enoughForLlm,
      missingKeys: missingKeys.slice(0, 60), // cap response size
      totalKeys: INTAKE_KEYS.length
    },
    hasIntake: args.hasIntakePayload,
    steps
  };
}
