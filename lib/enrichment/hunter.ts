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
