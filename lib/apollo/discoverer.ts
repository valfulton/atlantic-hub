/**
 * Apollo discovery — find COMPANIES matching ICP, insert as leads.
 *
 * Architecture (Path B — Val's plan doesn't include people search):
 *   1. organizations/search → list of matching companies
 *   2. Dedup by apollo_person_id (we reuse this column to store
 *      apollo_organization_id since the constraint is UNIQUE and one lead
 *      per Apollo entity is what we want regardless of person vs company)
 *   3. INSERT each new company as a lead with company-level data only:
 *      - company = Apollo org name
 *      - website = Apollo website_url
 *      - phone = Apollo primary_phone
 *      - industry = normalized industry
 *      - contact_name = NULL (Hunter will fill)
 *      - email = placeholder (Hunter will overwrite)
 *      - source_type = 'api'
 *      - source_payload = full Apollo org JSON for forensic audit
 *   4. Log to apollo_search_log
 *   5. Daily Hunter cron picks up these leads and enriches them with
 *      real people + emails on the next pass.
 */

import { getAvDb } from '@/lib/db/av';
import {
  apolloSearchOrganizations,
  apolloOrganizationTopPeople,
  extractApolloDomain,
  normalizeIndustry,
  ApolloApiKeyMissingError,
  ApolloApiError,
  type ApolloOrganization,
  type ApolloOrgSearchFilters,
  type ApolloPersonAtOrg
} from '@/lib/apollo/search';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { randomUUID } from 'crypto';

// How many top people to pull per company. Apollo's organization_top_people
// ranks by seniority — taking the top 1-2 typically gets you the owner/CEO.
// More = more leads + more LinkedIn URLs to outreach to, but also more rows
// in the dashboard. Start small.
const TOP_PEOPLE_PER_ORG = 2;

// api_search and organizations/search both consume credits on some tiers
// but don't gate hard on either. Use a high runaway-guard ceiling.
const DEFAULT_MONTHLY_SEARCH_CEILING = 10_000;

export type DiscoverTriggerSource = 'manual' | 'cron' | 'test';

export interface DiscoverResult {
  apolloOrganizationId: string;
  apolloPersonId?: string;
  outcome: 'inserted_person' | 'inserted_company_shell' | 'duplicate' | 'insert_failed';
  leadId?: number;
  details?: {
    company?: string;
    contactName?: string;
    contactTitle?: string;
    linkedinUrl?: string | null;
    domain?: string;
    industry?: string;
    employeeEstimate?: number | null;
    error?: string;
  };
}

export interface DiscoverBatchSummary {
  triggerSource: DiscoverTriggerSource;
  attempted: number;
  inserted: number;
  insertedPeople: number;
  insertedCompanyShells: number;
  duplicates: number;
  insertFailed: number;
  apolloResultsReturned: number;
  apolloTotalEntries: number;
  apolloPage: number;
  apolloPerPage: number;
  searchesUsedThisRun: number;
  searchesUsedThisMonth: number;
  searchesRemainingThisMonth: number;
  monthlyCeiling: number;
  results: DiscoverResult[];
  stoppedEarlyReason: string | null;
}

async function getMonthlySearchUsage(): Promise<number> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { n: number | string })[]>(
    `SELECT COUNT(*) AS n
       FROM apollo_search_log
      WHERE YEAR(called_at) = YEAR(UTC_TIMESTAMP())
        AND MONTH(called_at) = MONTH(UTC_TIMESTAMP())
        AND outcome IN ('success','no_results')`
  );
  return Number(rows[0]?.n ?? 0);
}

async function logSearch(opts: {
  filterPayload: ApolloOrgSearchFilters;
  resultsCount: number;
  insertedCount: number;
  outcome: 'success' | 'no_results' | 'error' | 'rate_limited' | 'quota_exceeded';
  triggerSource: DiscoverTriggerSource;
  actorUserId?: number | null;
  errorMessage?: string | null;
}): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `INSERT INTO apollo_search_log
       (endpoint, filter_payload, results_count, inserted_count,
        credits_charged, trigger_source, outcome, actor_user_id, error_message)
     VALUES ('organizations/search', ?, ?, ?, 1, ?, ?, ?, ?)`,
    [
      JSON.stringify(opts.filterPayload),
      opts.resultsCount,
      opts.insertedCount,
      opts.triggerSource,
      opts.outcome,
      opts.actorUserId ?? null,
      opts.errorMessage ?? null
    ]
  );
}

/**
 * Insert one Apollo organization as a COMPANY-SHELL lead (used as fallback
 * when organization_top_people returns no contacts for that org).
 * Dedups on apollo_person_id (storing Apollo's organization id there).
 */
async function insertApolloOrgAsLead(org: ApolloOrganization): Promise<DiscoverResult> {
  const apolloOrgId = org.id;
  const company = org.name || 'Unknown company';
  const domain = extractApolloDomain(org.website_url || org.primary_domain);
  const website = org.website_url || (org.primary_domain ? `https://${org.primary_domain}` : null);
  const phone = org.primary_phone?.number || null;
  const industry = normalizeIndustry(org.industry);
  const placeholderEmail = `apollo+org-${apolloOrgId}@eventsbywater.com`;
  const auditId = randomUUID();

  const db = getAvDb();

  const [existing] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE apollo_person_id = ? LIMIT 1`,
    [apolloOrgId]
  );
  if (existing.length > 0) {
    return {
      apolloOrganizationId: apolloOrgId,
      outcome: 'duplicate',
      leadId: existing[0].id,
      details: { company, domain: domain ?? undefined, industry: industry ?? undefined, employeeEstimate: org.estimated_num_employees }
    };
  }

  const sourcePayload = {
    source: 'apollo.io/organizations_search',
    apollo_organization_id: apolloOrgId,
    apollo_industry: org.industry,
    apollo_linkedin_url: org.linkedin_url,
    apollo_short_description: org.short_description,
    apollo_estimated_num_employees: org.estimated_num_employees,
    apollo_location: [org.city, org.state, org.country].filter(Boolean).join(', ')
  };

  try {
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO leads (
         audit_id, company, email, phone, website,
         industry, lead_status, source_type, source_payload, apollo_person_id,
         last_activity_at
       )
       VALUES (?, ?, ?, ?, ?, ?, 'new', 'api', ?, ?, NOW())`,
      [auditId, company, placeholderEmail, phone, website, industry, JSON.stringify(sourcePayload), apolloOrgId]
    );

    return {
      apolloOrganizationId: apolloOrgId,
      outcome: 'inserted_company_shell',
      leadId: result.insertId,
      details: { company, domain: domain ?? undefined, industry: industry ?? undefined, employeeEstimate: org.estimated_num_employees }
    };
  } catch (err) {
    return {
      apolloOrganizationId: apolloOrgId,
      outcome: 'insert_failed',
      details: { company, error: (err as Error).message }
    };
  }
}

/**
 * Insert one Apollo PERSON (returned from organization_top_people) as a
 * named lead. Dedups on apollo_person_id (the real Apollo person id, not
 * the org id). Stores full company context on the row.
 */
async function insertApolloPersonAsLead(
  person: ApolloPersonAtOrg,
  org: ApolloOrganization
): Promise<DiscoverResult> {
  const apolloPersonId = person.id;
  const apolloOrgId = org.id;
  const company = org.name || 'Unknown company';
  const name = person.name || [person.first_name, person.last_name].filter(Boolean).join(' ') || 'Unknown';
  const title = person.title || person.headline || null;
  const domain = extractApolloDomain(org.website_url || org.primary_domain);
  const website = org.website_url || (org.primary_domain ? `https://${org.primary_domain}` : null);
  const phone = org.primary_phone?.number || null;
  const industry = normalizeIndustry(org.industry);
  const linkedinUrl = person.linkedin_url || null;
  const placeholderEmail = `apollo+person-${apolloPersonId}@eventsbywater.com`;
  const auditId = randomUUID();

  const db = getAvDb();

  const [existing] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE apollo_person_id = ? LIMIT 1`,
    [apolloPersonId]
  );
  if (existing.length > 0) {
    return {
      apolloOrganizationId: apolloOrgId,
      apolloPersonId,
      outcome: 'duplicate',
      leadId: existing[0].id,
      details: { company, contactName: name, contactTitle: title ?? undefined }
    };
  }

  const sourcePayload = {
    source: 'apollo.io/organization_top_people',
    apollo_person_id: apolloPersonId,
    apollo_organization_id: apolloOrgId,
    apollo_industry: org.industry,
    apollo_person_seniority: person.seniority,
    apollo_person_linkedin_url: linkedinUrl,
    apollo_person_location: [person.city, person.state, person.country].filter(Boolean).join(', '),
    apollo_org_estimated_num_employees: org.estimated_num_employees
  };

  try {
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO leads (
         audit_id, company, contact_name, contact_title, email, phone, website,
         industry, lead_status, source_type, source_payload, apollo_person_id,
         last_activity_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', 'api', ?, ?, NOW())`,
      [auditId, company, name, title, placeholderEmail, phone, website, industry, JSON.stringify(sourcePayload), apolloPersonId]
    );

    return {
      apolloOrganizationId: apolloOrgId,
      apolloPersonId,
      outcome: 'inserted_person',
      leadId: result.insertId,
      details: {
        company,
        contactName: name,
        contactTitle: title ?? undefined,
        linkedinUrl,
        domain: domain ?? undefined,
        industry: industry ?? undefined,
        employeeEstimate: org.estimated_num_employees
      }
    };
  } catch (err) {
    return {
      apolloOrganizationId: apolloOrgId,
      apolloPersonId,
      outcome: 'insert_failed',
      details: { company, contactName: name, error: (err as Error).message }
    };
  }
}

/**
 * For one organization: call organization_top_people, insert the top N
 * people as named leads. If Apollo has no people on file for that org,
 * fall back to inserting a company shell.
 */
async function discoverPeopleForOrg(org: ApolloOrganization): Promise<DiscoverResult[]> {
  let topPeopleResult;
  try {
    topPeopleResult = await apolloOrganizationTopPeople(org.id, { perPage: TOP_PEOPLE_PER_ORG });
  } catch (err) {
    // top_people errored — fall back to company shell so the lead still lands.
    // Common reasons: rate limit, transient API issue, missing data for this org.
    console.error('[discoverer:top_people]', org.name, (err as Error).message);
    return [await insertApolloOrgAsLead(org)];
  }

  const people = topPeopleResult.people.slice(0, TOP_PEOPLE_PER_ORG);

  if (people.length === 0) {
    // Apollo doesn't have anyone listed at this company — insert company shell;
    // Hunter cron can still try the domain.
    return [await insertApolloOrgAsLead(org)];
  }

  const results: DiscoverResult[] = [];
  for (const person of people) {
    results.push(await insertApolloPersonAsLead(person, org));
  }
  return results;
}

export async function runDiscoveryBatch(opts: {
  filters: ApolloOrgSearchFilters;
  triggerSource: DiscoverTriggerSource;
  actorUserId?: number | null;
  monthlyCeiling?: number;
}): Promise<DiscoverBatchSummary> {
  const triggerSource = opts.triggerSource;
  const monthlyCeiling = opts.monthlyCeiling ?? DEFAULT_MONTHLY_SEARCH_CEILING;
  const actorUserId = opts.actorUserId ?? null;

  const usedThisMonth = await getMonthlySearchUsage();
  const remaining = Math.max(0, monthlyCeiling - usedThisMonth);

  if (remaining <= 0) {
    await logSearch({
      filterPayload: opts.filters,
      resultsCount: 0,
      insertedCount: 0,
      outcome: 'quota_exceeded',
      triggerSource,
      actorUserId,
      errorMessage: `Monthly ceiling ${monthlyCeiling} reached`
    });
    return {
      triggerSource,
      attempted: 0,
      inserted: 0,
      insertedPeople: 0,
      insertedCompanyShells: 0,
      duplicates: 0,
      insertFailed: 0,
      apolloResultsReturned: 0,
      apolloTotalEntries: 0,
      apolloPage: 0,
      apolloPerPage: 0,
      searchesUsedThisRun: 0,
      searchesUsedThisMonth: usedThisMonth,
      searchesRemainingThisMonth: 0,
      monthlyCeiling,
      results: [],
      stoppedEarlyReason: `Monthly Apollo search ceiling reached (${usedThisMonth}/${monthlyCeiling})`
    };
  }

  let apolloResult;
  try {
    apolloResult = await apolloSearchOrganizations(opts.filters);
  } catch (err) {
    const isApiKey = err instanceof ApolloApiKeyMissingError;
    const isApi = err instanceof ApolloApiError;
    const msg = isApiKey ? 'APOLLO_API_KEY missing' : isApi ? `${err.status}: ${err.body.slice(0, 200)}` : (err as Error).message;
    await logSearch({
      filterPayload: opts.filters,
      resultsCount: 0,
      insertedCount: 0,
      outcome: 'error',
      triggerSource,
      actorUserId,
      errorMessage: msg
    });
    return {
      triggerSource,
      attempted: 0,
      inserted: 0,
      insertedPeople: 0,
      insertedCompanyShells: 0,
      duplicates: 0,
      insertFailed: 0,
      apolloResultsReturned: 0,
      apolloTotalEntries: 0,
      apolloPage: 0,
      apolloPerPage: 0,
      searchesUsedThisRun: 1,
      searchesUsedThisMonth: usedThisMonth + 1,
      searchesRemainingThisMonth: Math.max(0, monthlyCeiling - usedThisMonth - 1),
      monthlyCeiling,
      results: [],
      stoppedEarlyReason: `Apollo API error: ${msg}`
    };
  }

  const orgs = apolloResult.organizations;
  const results: DiscoverResult[] = [];
  let insertedPeople = 0;
  let insertedCompanyShells = 0;
  let duplicates = 0;
  let insertFailed = 0;

  for (const org of orgs) {
    const orgResults = await discoverPeopleForOrg(org);
    for (const r of orgResults) {
      results.push(r);
      if (r.outcome === 'inserted_person') insertedPeople++;
      else if (r.outcome === 'inserted_company_shell') insertedCompanyShells++;
      else if (r.outcome === 'duplicate') duplicates++;
      else insertFailed++;
    }
  }
  const inserted = insertedPeople + insertedCompanyShells;

  await logSearch({
    filterPayload: opts.filters,
    resultsCount: orgs.length,
    insertedCount: inserted,
    outcome: orgs.length === 0 ? 'no_results' : 'success',
    triggerSource,
    actorUserId,
    errorMessage: null
  });

  return {
    triggerSource,
    attempted: orgs.length,
    inserted,
    insertedPeople,
    insertedCompanyShells,
    duplicates,
    insertFailed,
    apolloResultsReturned: orgs.length,
    apolloTotalEntries: apolloResult.pagination.total_entries,
    apolloPage: apolloResult.pagination.page,
    apolloPerPage: apolloResult.pagination.per_page,
    searchesUsedThisRun: 1,
    searchesUsedThisMonth: usedThisMonth + 1,
    searchesRemainingThisMonth: Math.max(0, monthlyCeiling - usedThisMonth - 1),
    monthlyCeiling,
    results,
    stoppedEarlyReason: null
  };
}
