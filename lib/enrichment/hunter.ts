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
    // (#288) val reported the displayed numbers (220/75) don't match her
    // hunter.io dashboard (22/50). Suspecting we're reading the WRONG field
    // — Hunter has separate counters: data.calls (some aggregate),
    // data.requests.searches (domain searches), .verifications,
    // .email_finder, .email_count, etc. Each could report a different scope
    // (cumulative vs monthly, team vs user). Dump the whole response so we
    // can see which field matches her real usage and key off the right one.
    console.log('[hunter:account] FULL response data:', JSON.stringify(data, null, 2));
    // Try several known shapes in priority order. After seeing the dump
    // we'll know which one to keep.
    const calls = (data as { calls?: { used?: number; available?: number } }).calls;
    const requests = (data as { requests?: Record<string, { used?: number; available?: number }> }).requests;
    type Shape = { used: number; available: number; label: string };
    const candidates: Shape[] = [];
    if (typeof calls?.used === 'number' && typeof calls?.available === 'number') {
      candidates.push({ used: calls.used, available: calls.available, label: 'calls' });
    }
    if (requests) {
      for (const [key, ctr] of Object.entries(requests)) {
        if (typeof ctr?.used === 'number' && typeof ctr?.available === 'number') {
          candidates.push({ used: ctr.used, available: ctr.available, label: `requests.${key}` });
        }
      }
    }
    if (candidates.length === 0) {
      console.error('[hunter:account] no recognized counter — data keys:', Object.keys(data as object).join(','));
      return null;
    }
    console.log('[hunter:account] candidate counters:', candidates.map((c) => `${c.label}=${c.used}/${c.available}`).join(' · '));
    // Pick the one whose `available` matches her plan most plausibly. For
    // now keep using the first one found, but the dump above lets us pick
    // a better default once we see what matches her dashboard.
    const chosen = candidates[0];
    console.log(`[hunter:account] live read OK via shape="${chosen.label}" used=${chosen.used} available=${chosen.available}`);
    const used = chosen.used;
    const available = chosen.available;
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
 * Rank Hunter's contact list by likelihood of being a decision-maker.
 * Returns the best single contact, or null if the list is empty.
 *
 * Priority:
 *   1. Title keywords (owner, founder, CEO, GM, director, manager...)
 *   2. Hunter confidence score (0-100)
 *   3. Penalize generic mailboxes (info@, sales@, etc.)
 */
export function pickBestContact(emails: HunterContact[]): HunterContact | null {
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

  const scored = emails.map((c) => {
    const pos = c.position || '';
    let titleScore = 0;
    for (let i = 0; i < TITLE_PRIORITY.length; i++) {
      if (TITLE_PRIORITY[i].test(pos)) {
        titleScore = TITLE_PRIORITY.length - i;
        break;
      }
    }
    const confidence = c.confidence ?? 0;
    const genericPenalty = GENERIC_LOCAL_PART.test(c.value || '') ? -50 : 0;
    return { contact: c, score: titleScore * 100 + confidence + genericPenalty };
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
