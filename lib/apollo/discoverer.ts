/**
 * Apollo discovery — run a Search API call, dedup, INSERT new leads.
 *
 * Used by:
 *   - app/api/admin/av/discover/route.ts (manual trigger from /admin/av/discover)
 *
 * Pipeline:
 *   1. Read ICP filters from the UI form
 *   2. Call Apollo mixed_people/search
 *   3. For each result: check apollo_person_id exists already → skip if so
 *   4. INSERT new leads with source_type='api', source_payload = raw apollo
 *      person, contact_name = "First Last", contact_title = title,
 *      website = company's website_url, etc.
 *   5. Email left as placeholder (`apollo+<apollo_id>@eventsbywater.com`)
 *      so the next Hunter enrichment run fills in the real email.
 *   6. Log the call to apollo_search_log for credit tracking.
 *   7. Optionally log a 'created' lead_event per new lead.
 *
 * NO AI scoring happens here — that's a separate Netlify scheduled
 * function that picks up unscored leads (next-session work).
 */

import { getAvDb } from '@/lib/db/av';
import {
  apolloSearchPeople,
  extractApolloDomain,
  normalizeIndustry,
  ApolloApiKeyMissingError,
  ApolloApiError,
  type ApolloPerson,
  type ApolloSearchFilters
} from '@/lib/apollo/search';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { randomUUID } from 'crypto';

// Default monthly Apollo SEARCH-call ceiling. Apollo Basic plan typically
// gives 100-200 search calls/month. We guard at 80 by default. Override
// per-call with monthlyCeiling.
const DEFAULT_MONTHLY_SEARCH_CEILING = 80;

export type DiscoverTriggerSource = 'manual' | 'cron' | 'test';

export interface DiscoverResult {
  apolloPersonId: string;
  outcome: 'inserted' | 'duplicate' | 'insert_failed';
  leadId?: number;
  details?: {
    name?: string;
    title?: string;
    company?: string;
    domain?: string;
    error?: string;
  };
}

export interface DiscoverBatchSummary {
  triggerSource: DiscoverTriggerSource;
  attempted: number;
  inserted: number;
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
  filterPayload: ApolloSearchFilters;
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
     VALUES ('mixed_people/search', ?, ?, ?, 1, ?, ?, ?, ?)`,
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
 * Insert one Apollo person as a new lead. Dedups by apollo_person_id.
 */
async function insertApolloLead(person: ApolloPerson): Promise<DiscoverResult> {
  const apolloPersonId = person.id;
  const name = person.name || [person.first_name, person.last_name].filter(Boolean).join(' ') || 'Unknown';
  const title = person.title || person.headline || null;
  const orgName = person.organization?.name || null;
  const company = orgName || name || 'Unknown';
  const domain = extractApolloDomain(person.organization?.website_url);
  const website = person.organization?.website_url || null;
  const phone = person.organization?.primary_phone?.number || null;
  const industry = normalizeIndustry(person.organization?.industry);
  const linkedinUrl = person.linkedin_url || null;
  const placeholderEmail = `apollo+${apolloPersonId}@eventsbywater.com`;
  const auditId = randomUUID();

  const db = getAvDb();

  // Check dedup first
  const [existing] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE apollo_person_id = ? LIMIT 1`,
    [apolloPersonId]
  );
  if (existing.length > 0) {
    return {
      apolloPersonId,
      outcome: 'duplicate',
      leadId: existing[0].id,
      details: { name, title: title ?? undefined, company, domain: domain ?? undefined }
    };
  }

  // Build the source_payload JSON for forensic audit + future re-enrich
  const sourcePayload = {
    source: 'apollo.io/mixed_people_search',
    apollo_person_id: apolloPersonId,
    linkedin_url: linkedinUrl,
    apollo_organization_id: person.organization?.id ?? null,
    apollo_industry: person.organization?.industry ?? null,
    person_location: [person.city, person.state, person.country].filter(Boolean).join(', '),
    employee_count_estimate: person.organization?.estimated_num_employees ?? null
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
      apolloPersonId,
      outcome: 'inserted',
      leadId: result.insertId,
      details: { name, title: title ?? undefined, company, domain: domain ?? undefined }
    };
  } catch (err) {
    return {
      apolloPersonId,
      outcome: 'insert_failed',
      details: {
        name,
        title: title ?? undefined,
        company,
        error: (err as Error).message
      }
    };
  }
}

export async function runDiscoveryBatch(opts: {
  filters: ApolloSearchFilters;
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
    apolloResult = await apolloSearchPeople(opts.filters);
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

  const people = apolloResult.people;
  const results: DiscoverResult[] = [];
  let inserted = 0;
  let duplicates = 0;
  let insertFailed = 0;

  for (const person of people) {
    const r = await insertApolloLead(person);
    results.push(r);
    if (r.outcome === 'inserted') inserted++;
    else if (r.outcome === 'duplicate') duplicates++;
    else insertFailed++;
  }

  await logSearch({
    filterPayload: opts.filters,
    resultsCount: people.length,
    insertedCount: inserted,
    outcome: people.length === 0 ? 'no_results' : 'success',
    triggerSource,
    actorUserId,
    errorMessage: null
  });

  return {
    triggerSource,
    attempted: people.length,
    inserted,
    duplicates,
    insertFailed,
    apolloResultsReturned: people.length,
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
