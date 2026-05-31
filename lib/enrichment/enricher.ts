/**
 * Core lead enrichment logic for Atlantic Hub.
 *
 * Picks leads with placeholder emails (or missing contact_name), calls Hunter
 * to find real people at that company's domain, writes the best contact back
 * to the lead row, logs a lead_events row, and tracks Hunter credit usage
 * against the monthly free-tier ceiling.
 *
 * Used by:
 *   - app/api/admin/av/enrich/route.ts  (manual trigger from /admin/av)
 *   - netlify/functions/enrich-cron.ts  (daily 6 AM cron)
 *
 * Schema dependencies (see schema/006_enrichment.sql):
 *   leads.enrichment_status, leads.enriched_at, leads.contact_title
 *   hunter_credit_log
 */

import { getAvDb } from '@/lib/db/av';
import {
  extractDomain,
  hunterDomainSearch,
  pickBestContact,
  HunterApiKeyMissingError,
  HunterApiError
} from '@/lib/enrichment/hunter';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

// Default monthly Hunter credit ceiling. Hunter free tier was bumped to
// 50/month (as of mid-2026); we guard at 45 to leave a buffer for manual
// retries. Override per-run via runEnrichmentBatch({ monthlyCeiling }).
// Paid tiers: Starter $34/mo = 500 credits; Growth = 5000; Pro = 50000.
// Monthly Hunter credit ceiling — a cost rail, not a cage. Override per
// deployment with the HUNTER_MONTHLY_CREDIT_CEILING env var (set it to your
// real Hunter plan's monthly credit allowance). Falls back to 45 if unset.
const DEFAULT_MONTHLY_CREDIT_CEILING = (() => {
  const n = Number(process.env.HUNTER_MONTHLY_CREDIT_CEILING);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 45;
})();
const PLACEHOLDER_EMAIL_PATTERNS = [
  /^prospect\+/i,
  /^test@/i,
  /^example@/i,
  /^no-?reply@/i,
  /^info@eventsbywater\.com$/i
];

function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return true;
  const trimmed = email.trim();
  if (!trimmed || trimmed === '—' || trimmed === '-') return true;
  return PLACEHOLDER_EMAIL_PATTERNS.some((re) => re.test(trimmed));
}

export type EnrichmentTriggerSource = 'manual' | 'cron' | 'test';

export interface EnrichmentResult {
  leadId: number;
  company: string;
  outcome: 'enriched' | 'no_domain' | 'no_results' | 'api_error' | 'skipped_credit_cap';
  details?: {
    newEmail?: string;
    newName?: string;
    newTitle?: string;
    newPhone?: string | null;
    confidence?: number | null;
    domain?: string;
    error?: string;
  };
}

export interface EnrichmentBatchSummary {
  triggerSource: EnrichmentTriggerSource;
  attempted: number;
  enriched: number;
  noResults: number;
  noDomain: number;
  apiErrors: number;
  creditsUsedThisRun: number;
  creditsUsedThisMonth: number;
  creditsRemainingThisMonth: number;
  monthlyCeiling: number;
  results: EnrichmentResult[];
  stoppedEarlyReason: string | null;
}

interface LeadRow extends RowDataPacket {
  id: number;
  company: string;
  contact_name: string | null;
  email: string;
  website: string | null;
  enrichment_status: string | null;
}

/**
 * Count Hunter API calls in the current calendar month (UTC).
 */
async function getMonthlyCreditUsage(): Promise<number> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { n: number | string })[]>(
    `SELECT COALESCE(SUM(credits_charged), 0) AS n
       FROM hunter_credit_log
      WHERE YEAR(called_at) = YEAR(UTC_TIMESTAMP())
        AND MONTH(called_at) = MONTH(UTC_TIMESTAMP())`
  );
  // mysql2 returns SUM(TINYINT) as a string (DECIMAL). Coerce explicitly so
  // arithmetic upstream (`usedThisMonth + creditsUsedThisRun`) doesn't string-concat.
  return Number(rows[0]?.n ?? 0);
}

/**
 * Hunter credit status for the cockpit's vendor strip.
 *
 * (#287) Source of truth = Hunter's own /account API. Our local
 * hunter_credit_log was over-counting (every call logged credits_charged=1
 * regardless of whether Hunter actually billed — Hunter only bills when an
 * email is found, not on no-results / errors). val's hub was showing
 * "100/100 credits, none left, top up Hunter" while Hunter.io itself showed
 * 22 used of 50, 28 remaining — a meaningless display that was actively
 * blocking enrichment runs.
 *
 * Falls back to the local count + env-var ceiling only if Hunter is
 * unreachable, so the cockpit still has something to show on outages.
 */
export async function getHunterCreditStatus(): Promise<{
  used: number;
  ceiling: number;
  remaining: number;
  /** 'live' = real numbers from Hunter's /account API.
   *  'estimate' = local hunter_credit_log count (overcounts — credits_charged
   *               is 1 on every call, but Hunter only bills on email-found).
   *               Treat as a hint, NOT a hard cap.  */
  source: 'live' | 'estimate';
}> {
  // Late-bind the import to keep this file from depending on Hunter at
  // module load (some tests import enricher.ts without HUNTER_API_KEY set).
  const { getHunterAccountStatus } = await import('@/lib/enrichment/hunter');
  const live = await getHunterAccountStatus().catch(() => null);
  if (live) {
    return { used: live.used, ceiling: live.available, remaining: live.remaining, source: 'live' };
  }
  const used = await getMonthlyCreditUsage().catch(() => 0);
  const ceiling = DEFAULT_MONTHLY_CREDIT_CEILING;
  return { used, ceiling, remaining: Math.max(0, ceiling - used), source: 'estimate' };
}

/**
 * Insert one row into hunter_credit_log.
 */
async function logCreditUsage(opts: {
  endpoint: string;
  leadId: number | null;
  domain: string | null;
  outcome: 'success' | 'no_results' | 'error' | 'rate_limited';
  triggerSource: EnrichmentTriggerSource;
  notes?: string | null;
}): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `INSERT INTO hunter_credit_log
       (endpoint, lead_id, domain, outcome, credits_charged, trigger_source, notes)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
    [opts.endpoint, opts.leadId, opts.domain, opts.outcome, opts.triggerSource, opts.notes ?? null]
  );
}

/**
 * Write a row to lead_events. event_type is mapped to 'ai_audited' (which
 * IS in the v4 ENUM) and the granular subtype is stored inside event_payload.
 */
async function logLeadEvent(
  leadId: number,
  clientId: number | null,
  subtype: string,
  payload: Record<string, unknown>
): Promise<void> {
  const db = getAvDb();
  try {
    await db.execute<ResultSetHeader>(
      `INSERT INTO lead_events (client_id, lead_id, event_type, event_payload, actor_role)
       VALUES (?, ?, 'ai_audited', ?, 'system')`,
      [clientId, leadId, JSON.stringify({ subtype, ...payload })]
    );
  } catch (err) {
    // Non-fatal — don't crash the enrichment if event log fails
    console.error('[enricher:lead_events]', (err as Error).message);
  }
}

/**
 * Pick the next N leads eligible for enrichment.
 *
 * Eligibility:
 *   - enrichment_status IS NULL OR not in ('enriched','failed_permanent','in_progress')
 *   - email matches a placeholder pattern OR contact_name is missing
 *   - archived_at IS NULL
 *   - website IS NOT NULL (Hunter needs a domain)
 *
 * Filters in SQL where cheap; applies the placeholder-email regex in JS
 * because MySQL regex syntax varies across versions.
 */
async function findCandidates(limit: number, clientId?: number | null): Promise<LeadRow[]> {
  const db = getAvDb();
  const scoped = clientId != null && clientId > 0;
  const [rows] = await db.execute<LeadRow[]>(
    `SELECT id, company, contact_name, email, website, enrichment_status, client_id
       FROM leads
      WHERE archived_at IS NULL
        ${scoped ? 'AND client_id = ?' : ''}
        AND (enrichment_status IS NULL
             OR enrichment_status NOT IN (
               'enriched',
               'failed_permanent',
               'in_progress',
               -- (#282) Skip leads Hunter already said 'no results' for.
               -- Previously they got re-attempted on every batch, burning
               -- another credit each time for the same dead domain. val
               -- can still manually retry a single lead from its detail
               -- page if she wants to re-check after a long gap.
               'failed_no_results',
               'failed_no_domain'
             ))
        AND website IS NOT NULL AND website != ''
      ORDER BY ai_score DESC, id ASC
      LIMIT 500`,
    scoped ? [clientId] : []
  );

  const filtered = rows.filter((r) => {
    const needsEmail = isPlaceholderEmail(r.email);
    const needsName = !r.contact_name || r.contact_name.startsWith('(') || r.contact_name === '—' || r.contact_name === '-';
    return needsEmail || needsName;
  });

  return filtered.slice(0, limit);
}

/**
 * Mark a lead in_progress (so concurrent runs don't pick it up). Returns
 * the previous status so we can unset if the run aborts mid-way.
 */
async function lockLead(leadId: number): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `UPDATE leads SET enrichment_status = 'in_progress' WHERE id = ?`,
    [leadId]
  );
}

async function markLeadStatus(leadId: number, status: string): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `UPDATE leads SET enrichment_status = ? WHERE id = ?`,
    [status, leadId]
  );
}

/**
 * Enrich one lead. Returns the result regardless of outcome (no throws
 * propagate out — Hunter errors are recorded and the run continues).
 */
async function enrichOne(
  lead: LeadRow & { client_id?: number | null },
  triggerSource: EnrichmentTriggerSource
): Promise<EnrichmentResult> {
  const startMs = Date.now();
  const domain = extractDomain(lead.website);

  if (!domain) {
    await markLeadStatus(lead.id, 'failed_no_domain');
    await logEvent({
      eventType: 'lead.enrichment_failed',
      leadId: lead.id,
      source: 'hunter',
      status: 'failure',
      payload: { company: lead.company, reason: 'no_domain', trigger_source: triggerSource },
      errorMessage: 'no domain extractable from website'
    });
    return { leadId: lead.id, company: lead.company, outcome: 'no_domain' };
  }

  await lockLead(lead.id);

  let domainResult;
  try {
    domainResult = await hunterDomainSearch(domain);
  } catch (err) {
    const isApiKey = err instanceof HunterApiKeyMissingError;
    const isApi = err instanceof HunterApiError;
    const msg = isApiKey ? 'HUNTER_API_KEY missing' : isApi ? err.details : (err as Error).message;
    await logCreditUsage({
      endpoint: 'domain-search',
      leadId: lead.id,
      domain,
      outcome: 'error',
      triggerSource,
      notes: msg
    });
    // Unset the in_progress lock — try again later
    await markLeadStatus(lead.id, lead.enrichment_status ?? '');
    await logEvent({
      eventType: 'lead.enrichment_failed',
      leadId: lead.id,
      source: 'hunter',
      status: 'failure',
      payload: { company: lead.company, domain, reason: 'api_error', trigger_source: triggerSource },
      errorMessage: msg.slice(0, 500),
      executionTimeMs: Date.now() - startMs
    });
    return {
      leadId: lead.id,
      company: lead.company,
      outcome: 'api_error',
      details: { domain, error: msg }
    };
  }

  // (#291) Apply per-client ICP title preferences (preferred/excluded) when
  // the lead has a client_id. Hunter often returns 5-10 contacts at a domain;
  // without this we'd happily pick HR or a generic recruiter even though val
  // has flagged "no gate-keepers" in the ICP. Best-effort only — if the ICP
  // load fails for any reason we still fall back to the built-in scoring.
  let titlePrefs: { preferredContactTitles: string[]; excludedContactTitles: string[] } | undefined;
  if (lead.client_id) {
    try {
      const { getClientIcp } = await import('@/lib/client/icp');
      const icp = await getClientIcp(lead.client_id);
      titlePrefs = {
        preferredContactTitles: icp.preferredContactTitles || [],
        excludedContactTitles: icp.excludedContactTitles || []
      };
    } catch {
      // ignore — pickBestContact will fall back to the built-in priority
    }
  }
  const best = pickBestContact(domainResult.emails, titlePrefs);

  if (!best) {
    await logCreditUsage({
      endpoint: 'domain-search',
      leadId: lead.id,
      domain,
      outcome: 'no_results',
      triggerSource
    });
    await markLeadStatus(lead.id, 'failed_no_results');
    await logLeadEvent(lead.id, lead.client_id ?? null, 'enrichment_no_results', { domain });
    await logEvent({
      eventType: 'lead.enrichment_failed',
      leadId: lead.id,
      source: 'hunter',
      status: 'partial',
      payload: { company: lead.company, domain, reason: 'no_hunter_results', trigger_source: triggerSource },
      executionTimeMs: Date.now() - startMs
    });
    return { leadId: lead.id, company: lead.company, outcome: 'no_results', details: { domain } };
  }

  const newEmail = best.value;
  const newName = [best.first_name, best.last_name].filter(Boolean).join(' ') || null;
  const newTitle = best.position || null;
  const newPhone = best.phone_number || null;

  // Build the UPDATE — only fields with new values
  const updates: string[] = [];
  const params: unknown[] = [];

  if (newEmail) {
    updates.push('email = ?');
    params.push(newEmail);
  }
  if (newName) {
    updates.push('contact_name = ?');
    params.push(newName);
  }
  if (newPhone) {
    updates.push('phone = ?');
    params.push(newPhone);
  }
  if (newTitle) {
    updates.push('contact_title = ?');
    params.push(newTitle);
  }
  updates.push("enrichment_status = 'enriched'");
  updates.push('enriched_at = NOW()');
  updates.push('last_activity_at = NOW()');

  const db = getAvDb();
  params.push(lead.id);
  await db.execute<ResultSetHeader>(
    `UPDATE leads SET ${updates.join(', ')} WHERE id = ?`,
    params
  );

  await logCreditUsage({
    endpoint: 'domain-search',
    leadId: lead.id,
    domain,
    outcome: 'success',
    triggerSource
  });

  await logLeadEvent(lead.id, lead.client_id ?? null, 'enriched', {
    domain,
    organization: domainResult.organization,
    email: newEmail,
    name: newName,
    title: newTitle,
    phone: newPhone,
    confidence: best.confidence,
    source: 'hunter.io'
  });

  await logEvent({
    eventType: 'lead.enriched',
    leadId: lead.id,
    source: 'hunter',
    status: 'success',
    payload: {
      company: lead.company,
      domain,
      new_email: newEmail,
      new_name: newName,
      new_title: newTitle,
      confidence: best.confidence,
      trigger_source: triggerSource
    },
    executionTimeMs: Date.now() - startMs
  });

  return {
    leadId: lead.id,
    company: lead.company,
    outcome: 'enriched',
    details: {
      newEmail,
      newName: newName ?? undefined,
      newTitle: newTitle ?? undefined,
      newPhone,
      confidence: best.confidence,
      domain
    }
  };
}

/**
 * Run an enrichment batch.
 *
 * @param limit          How many leads to attempt in this run (default 5)
 * @param triggerSource  'manual' | 'cron' | 'test' — recorded on every credit log row
 * @param monthlyCeiling Override the default 20-credit/month cap (e.g., for paid tier)
 */
export async function runEnrichmentBatch(opts: {
  limit?: number;
  triggerSource: EnrichmentTriggerSource;
  monthlyCeiling?: number;
  /** When set, only enrich leads belonging to this client's hub. */
  clientId?: number | null;
} = { triggerSource: 'manual' }): Promise<EnrichmentBatchSummary> {
  const limit = Math.max(1, Math.min(50, opts.limit ?? 5));
  const triggerSource = opts.triggerSource;
  const clientId = opts.clientId ?? null;

  // (#289) Credit gate now reads Hunter's LIVE /account API as source of
  // truth instead of our local hunter_credit_log + env-var ceiling. The
  // local count over-counts (logs 1 per call regardless of whether Hunter
  // billed) and the env ceiling drifts from the real plan — together they
  // blocked enrichment with bogus '100/100 reached' messages while val
  // actually had 28 credits left on hunter.io.
  //
  // The runtime override (opts.monthlyCeiling) is still honored so a one-off
  // batch can push past the live ceiling if val explicitly chooses (e.g.,
  // for a paid-tier session where she knows she's good).
  const { getHunterAccountStatus } = await import('@/lib/enrichment/hunter');
  const live = await getHunterAccountStatus().catch(() => null);

  let usedThisMonth: number;
  let monthlyCeiling: number;
  let remaining: number;
  let ceilingSource: 'live' | 'local';
  if (live) {
    usedThisMonth = live.used;
    monthlyCeiling = opts.monthlyCeiling ?? live.available;
    remaining = Math.max(0, monthlyCeiling - usedThisMonth);
    ceilingSource = 'live';
  } else {
    // Hunter unreachable — DON'T block on the broken local count. Trust
    // the run; Hunter itself will reject individual calls if actually out.
    usedThisMonth = await getMonthlyCreditUsage().catch(() => 0);
    monthlyCeiling = opts.monthlyCeiling ?? DEFAULT_MONTHLY_CREDIT_CEILING;
    remaining = Math.max(1, monthlyCeiling - usedThisMonth); // floor at 1 so we always at least try
    ceilingSource = 'local';
  }

  if (remaining <= 0) {
    return {
      triggerSource,
      attempted: 0,
      enriched: 0,
      noResults: 0,
      noDomain: 0,
      apiErrors: 0,
      creditsUsedThisRun: 0,
      creditsUsedThisMonth: usedThisMonth,
      creditsRemainingThisMonth: 0,
      monthlyCeiling,
      results: [],
      stoppedEarlyReason: `Hunter credit ceiling reached (${usedThisMonth}/${monthlyCeiling}, source=${ceilingSource}). Top up Hunter or wait for monthly reset.`
    };
  }

  const effectiveLimit = Math.min(limit, remaining);
  const candidates = await findCandidates(effectiveLimit, clientId);

  if (candidates.length === 0) {
    return {
      triggerSource,
      attempted: 0,
      enriched: 0,
      noResults: 0,
      noDomain: 0,
      apiErrors: 0,
      creditsUsedThisRun: 0,
      creditsUsedThisMonth: usedThisMonth,
      creditsRemainingThisMonth: remaining,
      monthlyCeiling,
      results: [],
      stoppedEarlyReason: 'No enrichment-eligible leads found.'
    };
  }

  const results: EnrichmentResult[] = [];
  let creditsUsedThisRun = 0;

  for (const lead of candidates) {
    // Resilience: one bad lead must NEVER abort the whole batch (or throw away
    // the results already gathered). enrichOne handles Hunter errors itself, but
    // any other throw (DB hiccup, etc.) is caught here so the run completes.
    let result: EnrichmentResult;
    try {
      result = await enrichOne(lead, triggerSource);
    } catch (err) {
      result = {
        leadId: lead.id,
        company: lead.company,
        outcome: 'api_error',
        details: { error: ((err as Error).message || 'unknown error').slice(0, 300) }
      };
      // Release the in_progress lock so it can be retried on a later run.
      await markLeadStatus(lead.id, lead.enrichment_status ?? '').catch(() => {});
    }
    results.push(result);

    // Every Hunter call (success or no_results) consumes a credit
    if (result.outcome === 'enriched' || result.outcome === 'no_results' || result.outcome === 'api_error') {
      creditsUsedThisRun += 1;
    }

    // Be polite to Hunter — 1.1s between calls (free tier rate limit is 15/min)
    if (lead !== candidates[candidates.length - 1]) {
      await new Promise((r) => setTimeout(r, 1100));
    }

    // Check if we just hit the ceiling mid-run
    if (usedThisMonth + creditsUsedThisRun >= monthlyCeiling) {
      break;
    }
  }

  return {
    triggerSource,
    attempted: results.length,
    enriched: results.filter((r) => r.outcome === 'enriched').length,
    noResults: results.filter((r) => r.outcome === 'no_results').length,
    noDomain: results.filter((r) => r.outcome === 'no_domain').length,
    apiErrors: results.filter((r) => r.outcome === 'api_error').length,
    creditsUsedThisRun,
    creditsUsedThisMonth: usedThisMonth + creditsUsedThisRun,
    creditsRemainingThisMonth: Math.max(0, monthlyCeiling - usedThisMonth - creditsUsedThisRun),
    monthlyCeiling,
    results,
    stoppedEarlyReason: null
  };
}
