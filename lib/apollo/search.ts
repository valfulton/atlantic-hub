/**
 * Apollo.io Search API client — adapted for plans that DON'T include
 * the people-search endpoint (mixed_people/api_search).
 *
 * Path B architecture:
 *   1. Call organizations/search to find COMPANIES matching ICP filters
 *      (locations, industries, employee size, keywords, specific domains)
 *   2. INSERT each company as a lead with company-level data only
 *      (no contact_name, contact_title, or real email yet — those columns
 *       stay NULL/placeholder)
 *   3. Daily Hunter cron picks up these new leads and enriches:
 *      domain → real person → real email → contact title
 *
 * Plan compatibility (per Val's Apollo key permissions):
 *   ✅ api/v1/organizations/search       ← what we use
 *   ✅ api/v1/organizations/enrich       ← future: enrich a known company
 *   ✅ api/v1/mixed_people/organization_top_people ← future: people lookup
 *   🚫 api/v1/mixed_people/api_search    ← NOT on her plan (Professional+ only)
 *   🚫 api/v1/people/match                ← NOT on her plan
 *
 * Reads APOLLO_API_KEY from process.env (set on Netlify, master key scope).
 *
 * Docs: https://docs.apollo.io/reference/organization-search
 *       (Note: docs page describes mixed_companies/search which is the
 *        modern/richer name. organizations/search is the legacy endpoint
 *        Val's plan allows; same request shape, simpler filter set.)
 */

const APOLLO_BASE = 'https://api.apollo.io/api/v1';

export interface ApolloOrganization {
  id: string;
  name: string | null;
  website_url: string | null;
  primary_phone: { number: string | null } | null;
  industry: string | null;
  estimated_num_employees: number | null;
  primary_domain: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  linkedin_url: string | null;
  short_description: string | null;
}

export interface ApolloOrganizationSearchResult {
  organizations: ApolloOrganization[];
  pagination: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
}

export interface ApolloOrgSearchFilters {
  /** Exact-ish company name search */
  qOrganizationName?: string;
  /** Locations of company HQ */
  organizationLocations?: string[];
  /** Locations to EXCLUDE (Apollo's organization_not_locations) */
  organizationNotLocations?: string[];
  /** Specific company domains to search */
  qOrganizationDomainsList?: string[];
  /** Industry keyword tags (Apollo's taxonomy) */
  qOrganizationKeywordTags?: string[];
  /** Company size ranges as "min,max" strings, e.g. ['1,10','11,50'] */
  organizationNumEmployeesRanges?: string[];
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
 * Call Apollo's organizations/search endpoint to find companies by ICP.
 */
export async function apolloSearchOrganizations(filters: ApolloOrgSearchFilters): Promise<ApolloOrganizationSearchResult> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) throw new ApolloApiKeyMissingError();

  const body: Record<string, unknown> = {
    page: filters.page ?? 1,
    per_page: Math.min(100, Math.max(1, filters.perPage ?? 25))
  };

  if (filters.qOrganizationName) {
    body.q_organization_name = filters.qOrganizationName;
  }
  if (filters.organizationLocations && filters.organizationLocations.length > 0) {
    body.organization_locations = filters.organizationLocations;
  }
  if (filters.organizationNotLocations && filters.organizationNotLocations.length > 0) {
    body.organization_not_locations = filters.organizationNotLocations;
  }
  if (filters.qOrganizationDomainsList && filters.qOrganizationDomainsList.length > 0) {
    body.q_organization_domains_list = filters.qOrganizationDomainsList;
  }
  if (filters.qOrganizationKeywordTags && filters.qOrganizationKeywordTags.length > 0) {
    body.q_organization_keyword_tags = filters.qOrganizationKeywordTags;
  }
  if (filters.organizationNumEmployeesRanges && filters.organizationNumEmployeesRanges.length > 0) {
    body.organization_num_employees_ranges = filters.organizationNumEmployeesRanges;
  }

  const url = `${APOLLO_BASE}/organizations/search`;

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
    organizations?: ApolloOrganization[];
    pagination?: ApolloOrganizationSearchResult['pagination'];
  };

  return {
    organizations: json.organizations || [],
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
