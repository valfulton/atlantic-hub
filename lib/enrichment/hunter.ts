/**
 * Hunter.io API client for lead enrichment.
 *
 * Atlantic Hub uses Hunter to find real names + emails for placeholder
 * prospects in shhdbite_AV.leads. Free tier = 25 searches/month; Starter
 * = 500/month. The enricher gates calls on the hunter_credit_log table
 * (see schema/006_enrichment.sql) before invoking this module.
 *
 * Reads `HUNTER_API_KEY` from process.env. The key is set on Netlify
 * (not in any local .env) — single source of truth.
 */

const HUNTER_BASE = 'https://api.hunter.io/v2';

export interface HunterContact {
  value: string;            // the email address
  first_name: string | null;
  last_name: string | null;
  position: string | null;  // job title
  phone_number: string | null;
  confidence: number | null; // 0-100
}

export interface HunterDomainResult {
  domain: string;
  organization: string | null;
  emails: HunterContact[];
  pattern: string | null;
}

export class HunterApiKeyMissingError extends Error {
  constructor() {
    super('HUNTER_API_KEY is not set in Netlify environment variables');
    this.name = 'HunterApiKeyMissingError';
  }
}

/**
 * (#287) Real-time Hunter account info. Source of truth for "credits used /
 * remaining" — replaces our local hunter_credit_log counting which was
 * over-counting (we logged credits_charged=1 on every call regardless of
 * whether Hunter actually billed it). Now the cockpit reads what Hunter
 * actually charged.
 *
 * Returns null on any failure (no API key, network error, parse error,
 * unexpected response shape). Callers should fall back to a safe display
 * ('—' or local estimate) when null. Never throws.
 */
export interface HunterAccountStatus {
  used: number;
  available: number;
  remaining: number;
  planName: string | null;
  resetDate: string | null;
}
export async function getHunterAccountStatus(): Promise<HunterAccountStatus | null> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) {
    console.error('[hunter:account] HUNTER_API_KEY env var is not set on Netlify');
    return null;
  }
  try {
    const res = await fetch(`${HUNTER_BASE}/account?api_key=${encodeURIComponent(apiKey)}`, {
      cache: 'no-store'
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      console.error('[hunter:account] non-OK response', res.status, bodyText.slice(0, 300));
      return null;
    }
    const j = await res.json().catch(() => null);
    if (!j) {
      console.error('[hunter:account] response was not valid JSON');
      return null;
    }
    const data = (j as { data?: Record<string, unknown> })?.data;
    if (!data || typeof data !== 'object') {
      console.error('[hunter:account] response had no .data field; got keys:', Object.keys(j as object).join(','));
      return null;
    }

    // Hunter's /account response has shifted over the years — try several
    // shapes in order. Log which shape matched so future drift is debuggable.
    // (#288) Hunter's response confirmed via diagnostic dump:
    //   data.calls: { _deprecation_notice: "Sums searches+verifications,
    //                 giving an unprecise look..." }  ← do NOT use
    //   data.requests.credits: { used: 22, available: 50 }  ← THIS matches
    //                          hunter.io dashboard
    //   data.requests.searches: same
    //   data.requests.verifications: { used: 44, available: 100 }
    //
    // We use data.requests.credits as the canonical "monthly credits left"
    // counter because Hunter itself marks .calls as deprecated. Fall back
    // to .searches then .calls only if .credits is missing (older API).
    const requests = (data as { requests?: Record<string, { used?: number; available?: number }> }).requests;
    const calls = (data as { calls?: { used?: number; available?: number } }).calls;
    let used: number | undefined;
    let available: number | undefined;
    let shape: string | null = null;
    if (typeof requests?.credits?.used === 'number' && typeof requests?.credits?.available === 'number') {
      used = requests.credits.used; available = requests.credits.available; shape = 'requests.credits';
    } else if (typeof requests?.searches?.used === 'number' && typeof requests?.searches?.available === 'number') {
      used = requests.searches.used; available = requests.searches.available; shape = 'requests.searches';
    } else if (typeof calls?.used === 'number' && typeof calls?.available === 'number') {
      used = calls.used; available = calls.available; shape = 'calls (deprecated fallback)';
    }
    if (typeof used !== 'number' || typeof available !== 'number') {
      console.error('[hunter:account] no recognized counter — data keys:', Object.keys(data as object).join(','));
      return null;
    }
    console.log(`[hunter:account] live read OK via shape="${shape}" used=${used} available=${available}`);
    return {
      used,
      available,
      remaining: Math.max(0, available - used),
      planName: typeof data.plan_name === 'string' ? data.plan_name : null,
      resetDate: typeof data.reset_date === 'string' ? data.reset_date : null
    };
  } catch (err) {
    console.error('[hunter:account] network/parse error:', (err as Error).message);
    return null;
  }
}

export class HunterApiError extends Error {
  details: string;
  status: number;
  constructor(status: number, details: string) {
    super(`Hunter.io API error ${status}: ${details}`);
    this.name = 'HunterApiError';
    this.status = status;
    this.details = details;
  }
}

/**
 * Search Hunter for everyone the API knows at the given domain.
 *
 * @param domain  e.g. "esterastcroix.com"
 * @returns       Hunter's domain-search result (organization + emails[])
 * @throws HunterApiKeyMissingError if HUNTER_API_KEY is not set
 * @throws HunterApiError on any non-200 response
 */
export async function hunterDomainSearch(domain: string): Promise<HunterDomainResult> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) throw new HunterApiKeyMissingError();

  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase().trim();
  if (!cleanDomain) {
    throw new HunterApiError(400, 'empty domain after cleaning');
  }

  const url = `${HUNTER_BASE}/domain-search?domain=${encodeURIComponent(cleanDomain)}&api_key=${apiKey}&limit=10`;

  const res = await fetch(url);
  const json = (await res.json()) as {
    data?: {
      domain: string;
      organization: string | null;
      emails: HunterContact[];
      pattern: string | null;
    };
    errors?: { id?: string; code?: number; details: string }[];
    meta?: { results?: number };
  };

  if (json.errors && json.errors.length > 0) {
    throw new HunterApiError(res.status, json.errors.map((e) => e.details).join('; '));
  }
  if (!json.data) {
    throw new HunterApiError(res.status, 'no data field in Hunter response');
  }

  return {
    domain: json.data.domain,
    organization: json.data.organization,
    emails: json.data.emails || [],
    pattern: json.data.pattern
  };
}

/**
 * (#292) Hunter's Email Finder endpoint — when we already know the person's
 * first + last name, ask Hunter directly instead of pulling the entire domain
 * roster. Same credit cost as Domain Search but the answer is targeted at the
 * named person (Hunter combines the domain pattern + name to find/verify the
 * specific address), so it sidesteps the "Hunter handed us info@ again"
 * problem entirely when we already have a real contact name on file.
 *
 * Returns a HunterContact (single, not a list) or null when Hunter can't find
 * the address. Throws on API failure same as hunterDomainSearch.
 */
export async function hunterEmailFinder(
  domain: string,
  firstName: string,
  lastName: string
): Promise<HunterContact | null> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) throw new HunterApiKeyMissingError();

  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase().trim();
  if (!cleanDomain) throw new HunterApiError(400, 'empty domain after cleaning');
  const fn = (firstName || '').trim();
  const ln = (lastName || '').trim();
  if (!fn || !ln) throw new HunterApiError(400, 'email-finder needs both first_name and last_name');

  const url = `${HUNTER_BASE}/email-finder?domain=${encodeURIComponent(cleanDomain)}&first_name=${encodeURIComponent(fn)}&last_name=${encodeURIComponent(ln)}&api_key=${apiKey}`;
  const res = await fetch(url);
  const json = (await res.json()) as {
    data?: {
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      score: number | null;       // 0-100 confidence
      position: string | null;
      phone_number: string | null;
    };
    errors?: { id?: string; code?: number; details: string }[];
  };
  if (json.errors && json.errors.length > 0) {
    throw new HunterApiError(res.status, json.errors.map((e) => e.details).join('; '));
  }
  if (!json.data || !json.data.email) return null; // Hunter knows the domain but couldn't find this person
  return {
    value: json.data.email,
    first_name: json.data.first_name,
    last_name: json.data.last_name,
    position: json.data.position,
    phone_number: json.data.phone_number,
    confidence: json.data.score
  };
}

/**
 * Rank Hunter's contact list by likelihood of being a decision-maker.
 * Returns the best single contact, or null if the list is empty.
 *
 * Priority:
 *   1. ICP preferredContactTitles (per-client overrides) — HUGE boost
 *   2. ICP excludedContactTitles — hard skip
 *   3. Built-in title keywords (owner, founder, CEO, GM, director, manager...)
 *   4. Hunter confidence score (0-100)
 *   5. Penalize generic mailboxes (info@, sales@, etc.)
 *
 * (#291) ICPPreferences allow each client to bias the picker toward roles
 * that matter for their pitch — e.g. EBW wants "Events Manager" / "Catering
 * Manager"; AV wants "Owner" / "Marketing Director". When omitted, falls
 * back to the built-in priority list (backward compatible).
 */
export interface ICPTitlePreferences {
  /** Titles to PREFER. Case-insensitive substring match. Top match wins big. */
  preferredContactTitles?: string[] | null;
  /** Titles to SKIP entirely. Case-insensitive substring match. Hard exclude. */
  excludedContactTitles?: string[] | null;
}

export function pickBestContact(
  emails: HunterContact[],
  preferences?: ICPTitlePreferences
): HunterContact | null {
  if (!emails || emails.length === 0) return null;

  const TITLE_PRIORITY: RegExp[] = [
    /\bowner\b/i,
    /\bfounder\b/i,
    /\bceo\b/i,
    /\bpresident\b/i,
    /\bprincipal\b/i,
    /\bgeneral\s*manager\b/i,
    /\bgm\b/i,
    /\bmanaging\s*director\b/i,
    /\bmd\b/i,
    /\bdirector\b/i,
    /\bhead\s+of\b/i,
    /\bvp\b/i,
    /\bvice\s*president\b/i,
    /\bsales\s*manager\b/i,
    /\bmarketing\s*manager\b/i,
    /\bevents?\s*manager\b/i,
    /\bcatering\s*manager\b/i,
    /\bmanager\b/i
  ];

  const GENERIC_LOCAL_PART = /^(info|hello|contact|support|sales|admin|office|team|reception|help)@/i;

  const preferred = (preferences?.preferredContactTitles || [])
    .map((s) => (s || '').trim().toLowerCase())
    .filter(Boolean);
  const excluded = (preferences?.excludedContactTitles || [])
    .map((s) => (s || '').trim().toLowerCase())
    .filter(Boolean);

  // Hard-exclude first. If everything got excluded, fall back to scoring
  // the original list — better a junky contact than nothing at all when
  // the operator's exclude list happens to nuke every hit.
  const eligible = excluded.length
    ? emails.filter((c) => {
        const pos = (c.position || '').toLowerCase();
        return !excluded.some((ex) => pos.includes(ex));
      })
    : emails;
  const pool = eligible.length > 0 ? eligible : emails;

  const scored = pool.map((c) => {
    const pos = c.position || '';
    const posLower = pos.toLowerCase();
    // Preferred-title bonus (additive, dwarfs the built-in priority).
    // Earlier match in the list = higher bonus.
    let preferredBonus = 0;
    for (let i = 0; i < preferred.length; i++) {
      if (posLower.includes(preferred[i])) {
        preferredBonus = 10_000 - i * 100; // first preferred wins biggest
        break;
      }
    }
    let titleScore = 0;
    for (let i = 0; i < TITLE_PRIORITY.length; i++) {
      if (TITLE_PRIORITY[i].test(pos)) {
        titleScore = TITLE_PRIORITY.length - i;
        break;
      }
    }
    const confidence = c.confidence ?? 0;
    const genericPenalty = GENERIC_LOCAL_PART.test(c.value || '') ? -50 : 0;
    return { contact: c, score: preferredBonus + titleScore * 100 + confidence + genericPenalty };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].contact;
}

/**
 * Pull a clean lowercase domain out of a website URL.
 * Returns null if the input doesn't look like a URL or hostname.
 */
export function extractDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  const trimmed = website.trim();
  if (!trimmed) return null;
  try {
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
}
