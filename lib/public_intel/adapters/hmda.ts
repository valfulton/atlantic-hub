/**
 * lib/public_intel/adapters/hmda.ts  (#368, val 2026-06-02)
 *
 * Home Mortgage Disclosure Act (HMDA) — federal, public, loan-level mortgage
 * application data with geocoded census tracts + denial reasons. FFIEC ships
 * a free public API. No key required.
 *
 * For Marty (consumer loans): this is target-list raw material. Knowing which
 * tracts have high refinance volume, which lenders are dominant, which
 * application populations are getting denied tells him exactly where to
 * source borrowers.
 *
 * API docs: https://ffiec.cfpb.gov/documentation/api/data-browser/
 * Free, rate-limited at ~10 req/s. We cache aggregates per (year, state, county)
 * with a 90-day expiry — HMDA data updates yearly so this is plenty fresh.
 */
import type { PublicIntelAdapter, RunContext, RunResult } from '../types';
import { storeRecord, findCachedRecord, noteRun } from '../store';

interface HmdaConfig {
  /** e.g. ["FL", "CA"] — operator's lending footprint. */
  states?: string[];
  /** e.g. ["12099", "06037"] — 5-digit state+county FIPS. Either states or counties. */
  countyFips?: string[];
  /** Year to pull. Default = latest published (currently 2024). */
  year?: number;
  /** Per-area: how many records to summarize. Default 5000. */
  sampleSize?: number;
}

interface HmdaAggregate {
  year: number;
  state: string;
  county_fips: string | null;
  total_applications: number;
  total_originated: number;
  total_denied: number;
  median_loan_amount: number | null;
  top_purposes: Array<{ purpose: string; count: number }>;
  top_loan_types: Array<{ loan_type: string; count: number }>;
  denial_rate: number | null;
  fetched_at: string;
}

export const HMDA_CURRENT_YEAR = 2024;
const CURRENT_YEAR = HMDA_CURRENT_YEAR;
export type { HmdaAggregate };
const CACHE_DAYS = 90;

function isHmdaConfig(c: unknown): c is HmdaConfig {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (o.states !== undefined && !(Array.isArray(o.states) && o.states.every((s) => typeof s === 'string'))) return false;
  if (o.countyFips !== undefined && !(Array.isArray(o.countyFips) && o.countyFips.every((s) => typeof s === 'string'))) return false;
  return true;
}

export async function fetchHmdaAggregate(year: number, state: string, county?: string): Promise<HmdaAggregate | null> {
  // FFIEC public data browser — aggregated counts endpoint. We ask for a
  // tract-level summary then aggregate ourselves to keep response sizes sane.
  // Endpoint shape per FFIEC docs:
  //   /v2/data-browser-api/view/aggregations?years=2024&states=FL&counties=12099
  const params = new URLSearchParams();
  params.set('years', String(year));
  params.set('states', state);
  if (county) params.set('counties', county);
  const url = `https://ffiec.cfpb.gov/v2/data-browser-api/view/aggregations?${params.toString()}`;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'AtlanticHub/1.0 (research)' }
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      aggregations?: Array<{
        actions_taken_count?: number;
        actions_taken?: Array<{ actions_taken: number; count: number }>;
        loan_amount?: { median?: number };
        loan_purposes?: Array<{ loan_purpose: number; count: number }>;
        loan_types?: Array<{ loan_type: number; count: number }>;
      }>;
    };
    const agg = j.aggregations?.[0];
    if (!agg) return null;

    // HMDA action_taken codes: 1=originated, 3=denied (per FFIEC spec).
    const actions = agg.actions_taken ?? [];
    const total = actions.reduce((s, a) => s + (a.count ?? 0), 0);
    const originated = actions.find((a) => a.actions_taken === 1)?.count ?? 0;
    const denied = actions.find((a) => a.actions_taken === 3)?.count ?? 0;
    const median = agg.loan_amount?.median ?? null;
    const PURPOSE_NAMES: Record<number, string> = { 1: 'Home purchase', 2: 'Home improvement', 31: 'Refinancing', 32: 'Cash-out refi', 4: 'Other purpose', 5: 'Not applicable' };
    const LOAN_TYPE_NAMES: Record<number, string> = { 1: 'Conventional', 2: 'FHA', 3: 'VA', 4: 'USDA / RHS' };

    return {
      year,
      state,
      county_fips: county ?? null,
      total_applications: total,
      total_originated: originated,
      total_denied: denied,
      median_loan_amount: median,
      top_purposes: (agg.loan_purposes ?? [])
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
        .slice(0, 5)
        .map((p) => ({ purpose: PURPOSE_NAMES[p.loan_purpose] ?? `code-${p.loan_purpose}`, count: p.count })),
      top_loan_types: (agg.loan_types ?? [])
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
        .slice(0, 5)
        .map((t) => ({ loan_type: LOAN_TYPE_NAMES[t.loan_type] ?? `code-${t.loan_type}`, count: t.count })),
      denial_rate: total > 0 ? denied / total : null,
      fetched_at: new Date().toISOString()
    };
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

export const hmdaAdapter: PublicIntelAdapter = {
  kind: 'hmda',
  displayName: 'HMDA mortgage data (federal)',
  description:
    'Loan-level mortgage applications across the US, geocoded by census tract with denial reasons. Free federal data. Gold for consumer-loan reps targeting active mortgage markets.',
  requiresKey: false,
  costNote: 'Free · FFIEC public API · ~10 req/s rate limit',
  bestFor: ['Marty (consumer loans)', 'Mortgage brokers', 'Loan officers'],

  validateConfig(config) {
    if (config == null) return null;
    if (!isHmdaConfig(config)) {
      return 'config must be { states?: string[], countyFips?: string[], year?: number, sampleSize?: number }';
    }
    if (config.year !== undefined && (typeof config.year !== 'number' || config.year < 2018 || config.year > CURRENT_YEAR)) {
      return `year must be a number between 2018 and ${CURRENT_YEAR}`;
    }
    return null;
  },

  async run(ctx: RunContext): Promise<RunResult> {
    const cfgRaw = ctx.source.config;
    const valError = this.validateConfig(cfgRaw);
    if (valError) {
      await noteRun({ sourceId: ctx.source.sourceId, status: 'error', detail: `bad config: ${valError}` });
      return { ok: false, written: 0, fromCache: 0, detail: `bad config: ${valError}` };
    }
    const cfg: HmdaConfig = (cfgRaw as HmdaConfig | null) ?? {};
    const year = cfg.year ?? CURRENT_YEAR;
    const states = (cfg.states ?? []).map((s) => s.toUpperCase());
    const counties = cfg.countyFips ?? [];

    // We loop the cartesian product of states × (counties || [null]) so a
    // pure "FL state" run still works without naming every county.
    const targets: Array<{ state: string; county?: string }> = [];
    if (counties.length > 0) {
      // Counties imply state from first two digits of FIPS — derive it.
      for (const c of counties) {
        const stCode = c.slice(0, 2);
        // FIPS->postal mapping kept minimal; expand as adoption grows.
        const FIPS_TO_POSTAL: Record<string, string> = { '06': 'CA', '12': 'FL', '36': 'NY', '48': 'TX', '17': 'IL' };
        const state = FIPS_TO_POSTAL[stCode];
        if (state) targets.push({ state, county: c });
      }
    } else if (states.length > 0) {
      for (const s of states) targets.push({ state: s });
    } else {
      await noteRun({ sourceId: ctx.source.sourceId, status: 'skipped', detail: 'no states or counties configured' });
      return { ok: false, written: 0, fromCache: 0, detail: 'no states or counties configured — set at least one in config' };
    }

    let written = 0;
    let fromCache = 0;
    const errors: string[] = [];

    for (const t of targets) {
      const entityKey = `hmda:${year}:${t.state}${t.county ? `:${t.county}` : ''}`;
      const cached = await findCachedRecord<HmdaAggregate>('hmda', entityKey);
      if (cached) {
        fromCache++;
        continue;
      }
      const agg = await fetchHmdaAggregate(year, t.state, t.county);
      if (!agg) {
        errors.push(entityKey);
        continue;
      }
      const summary = t.county
        ? `${year} HMDA · county ${t.county}: ${agg.total_applications.toLocaleString()} apps, ${(agg.denial_rate ?? 0 * 100).toFixed(1)}% denied`
        : `${year} HMDA · ${t.state}: ${agg.total_applications.toLocaleString()} apps`;
      const expires = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000);
      await storeRecord<HmdaAggregate>({
        sourceKind: 'hmda',
        entityKey,
        clientId: ctx.clientId ?? ctx.source.clientId,
        leadId: ctx.leadId ?? null,
        recordJson: agg,
        summaryLabel: summary.slice(0, 240),
        regionCode: t.county ?? t.state,
        expiresAt: expires
      });
      written++;
    }

    const detail = `${written} fetched, ${fromCache} from cache, ${errors.length} errored`;
    await noteRun({
      sourceId: ctx.source.sourceId,
      status: errors.length > 0 && written === 0 ? 'error' : 'ok',
      detail
    });
    return { ok: written > 0 || fromCache > 0, written, fromCache, detail };
  }
};
