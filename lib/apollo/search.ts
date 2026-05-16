/**
 * Apollo.io Search API client (mixed_people/api_search).
 *
 * Apollo's database: 275M+ contacts at 30M+ companies. Search by ICP
 * filters (titles, locations, seniorities, domains, industries,
 * company-size ranges) → returns people with company context. This is
 * the discovery layer for AV's lead-gen product.
 *
 * Reads APOLLO_API_KEY from process.env (set on Netlify, never local).
 *
 * CRITICAL — endpoint version (Apollo distinguishes two):
 *   /mixed_people/search       ← in-app UI use only; returns 401 to API callers
 *   /mixed_people/api_search   ← API-facing version; what we use here
 * Using the wrong one is the #1 cause of "401 Invalid access credentials".
 *
 * CRITICAL — Master API Key required:
 *   The api_search endpoint requires a key flagged as "Master API Key"
 *   in Apollo. When creating the key (Apollo → Settings → Integrations →
 *   API → Create new key), toggle "Set as master key" OR explicitly select
 *   all endpoints. A regular per-endpoint key WILL return 401.
 *
 * Credits: api_search DOES NOT consume credits per Apollo docs. Only
 * email/phone enrichment endpoints consume credits. So we log calls for
 * audit but don't gate on a monthly ceiling for search.
 *
 * Emails: api_search returns name + title + LinkedIn URL + company, but
 * NOT email. Emails are obtained via people-enrichment (paid credits).
 * Our pipeline inserts placeholder emails and lets Hunter.io enrich them
 * on the daily cron — same outcome, much cheaper.
 *
 * Docs: https://docs.apollo.io/reference/people-api-search
 * Auth: https://docs.apollo.io/docs/create-api-key
 */

const APOLLO_BASE = 'https://api.apollo.io/api/v1';

export interface ApolloPerson {
  id: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  title: string | null;
  headline: string | null;
  linkedin_url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  organization: {
    id: string;
    name: string | null;
    website_url: string | null;
    linkedin_url: string | null;
    primary_phone: { number: string | null } | null;
    industry: string | null;
    estimated_num_employees: number | null;
  } | null;
}

export interface ApolloSearchResult {
  people: ApolloPerson[];
  pagination: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
}

/**
 * Apollo's documented seniority enum values. Use these strings exactly.
 * https://docs.apollo.io/reference/people-api-search
 */
export type ApolloSeniority =
  | 'owner'
  | 'founder'
  | 'c_suite'
  | 'partner'
  | 'vp'
  | 'head'
  | 'director'
  | 'manager'
  | 'senior'
  | 'entry'
  | 'intern';

export interface ApolloSearchFilters {
  /** Job titles to search for, e.g. ['wedding planner', 'event coordinator'] */
  personTitles?: string[];
  /** Apollo seniority enum (owner, founder, c_suite, vp, etc.) */
  personSeniorities?: ApolloSeniority[];
  /** Locations for the PERSON, e.g. ['United States Virgin Islands', 'Saint Croix'] */
  personLocations?: string[];
  /** Locations for the COMPANY HQ (often more reliable than personLocations) */
  organizationLocations?: string[];
  /** Specific company domains to search, e.g. ['brewstx.com', 'esterastcroix.com'] */
  qOrganizationDomainsList?: string[];
  /** Industry strings (Apollo's taxonomy), e.g. ['hospitality', 'restaurants'] */
  organizationIndustries?: string[];
  /** Company size ranges as "min,max" strings, e.g. ['1,10', '11,50'] */
  organizationNumEmployeesRanges?: string[];
  /** Comma-separated keyword search across name/title/company */
  qKeywords?: string;
  /** Page number, 1-indexed */
  page?: number;
  /** Results per page (Apollo max = 100) */
  perPage?: number;
}

export class ApolloApiKeyMissingError extends Error {
  constructor() {
    super('APOLLO_API_KEY is not set in Netlify environment variables');
    this.name = 'ApolloApiKeyMissingError';
  }
}

export class ApolloApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Apollo API error ${status}: ${body.slice(0, 200)}`);
    this.name = 'ApolloApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Call Apollo's mixed_people/search endpoint.
 *
 * @throws ApolloApiKeyMissingError if APOLLO_API_KEY isn't set
 * @throws ApolloApiError on non-2xx response
 */
export async function apolloSearchPeople(filters: ApolloSearchFilters): Promise<ApolloSearchResult> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) throw new ApolloApiKeyMissingError();

  const body: Record<string, unknown> = {
    page: filters.page ?? 1,
    per_page: Math.min(100, Math.max(1, filters.perPage ?? 25))
  };

  if (filters.personTitles && filters.personTitles.length > 0) {
    body.person_titles = filters.personTitles;
  }
  if (filters.personSeniorities && filters.personSeniorities.length > 0) {
    body.person_seniorities = filters.personSeniorities;
  }
  if (filters.personLocations && filters.personLocations.length > 0) {
    body.person_locations = filters.personLocations;
  }
  if (filters.organizationLocations && filters.organizationLocations.length > 0) {
    body.organization_locations = filters.organizationLocations;
  }
  if (filters.qOrganizationDomainsList && filters.qOrganizationDomainsList.length > 0) {
    body.q_organization_domains_list = filters.qOrganizationDomainsList;
  }
  if (filters.organizationIndustries && filters.organizationIndustries.length > 0) {
    body.organization_industries = filters.organizationIndustries;
  }
  if (filters.organizationNumEmployeesRanges && filters.organizationNumEmployeesRanges.length > 0) {
    body.organization_num_employees_ranges = filters.organizationNumEmployeesRanges;
  }
  if (filters.qKeywords) {
    body.q_keywords = filters.qKeywords;
  }

  // CORRECT endpoint for API usage. /mixed_people/search (without _api_search)
  // is the in-app UI version and returns 401 to API callers.
  const url = `${APOLLO_BASE}/mixed_people/api_search`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new ApolloApiError(res.status, errBody);
  }

  const json = (await res.json()) as {
    people?: ApolloPerson[];
    pagination?: ApolloSearchResult['pagination'];
  };

  return {
    people: json.people || [],
    pagination: json.pagination || { page: 1, per_page: 0, total_entries: 0, total_pages: 0 }
  };
}

/**
 * Pull a clean website hostname out of Apollo's website_url field.
 */
export function extractApolloDomain(websiteUrl: string | null | undefined): string | null {
  if (!websiteUrl) return null;
  try {
    const url = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Derive an industry slug from Apollo's industry string for fitting into
 * shhdbite_AV.leads.industry. Apollo returns full names like "Restaurants"
 * or "Hospitality"; we normalize to short slugs.
 */
export function normalizeIndustry(apolloIndustry: string | null | undefined): string | null {
  if (!apolloIndustry) return null;
  const lower = apolloIndustry.toLowerCase();
  if (/wedding|event/.test(lower)) return 'wedding_planner';
  if (/restaurant|food.*service|bar/.test(lower)) return 'restaurant';
  if (/hotel|resort|accommodation/.test(lower)) return 'corporate_retreat';
  if (/marketing|advertising/.test(lower)) return 'agency';
  if (/non.?profit|trade.*association/.test(lower)) return 'industry_org';
  return 'other';
}
