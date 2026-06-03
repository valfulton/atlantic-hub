/**
 * lib/public_intel/adapters/census_acs.ts  (#370, val 2026-06-02)
 *
 * Census Bureau — American Community Survey (ACS). The federal denominator
 * under HMDA. Tract-level household income, housing tenure, mortgage burden,
 * occupation, education. Public, free, real JSON API. A key is recommended
 * for >500 req/day but optional at SMB scale.
 *
 * For Marty: pairs with HMDA. HMDA tells you mortgage volume + denial rate;
 * ACS tells you median income, % owner-occupied, % cost-burdened (>30% of
 * income on housing). Combine the two and you have a "where are owners
 * stretched and applying for credit" map — Marty's exact target list.
 *
 * For Adriana: occupation + income distribution help identify high-equity
 * neighborhoods adjacent to distress signals from CA SOS suspensions.
 *
 * API docs: https://www.census.gov/data/developers/data-sets/acs-5year.html
 * Endpoint:
 *   https://api.census.gov/data/{year}/acs/acs5?get={vars}&for=county:{fips}&in=state:{st}
 *   Key (optional): &key=...
 *
 * We pull a small fixed bundle of high-signal variables, normalized into a
 * friendly shape. Cache 180d — ACS publishes once per year.
 */
import type { PublicIntelAdapter, RunContext, RunResult } from '../types';
import { storeRecord, findCachedRecord, noteRun } from '../store';

interface CensusAcsConfig {
  /** 5-digit state+county FIPS ("12099" = Palm Beach, FL). */
  countyFips?: string[];
  /** Or 2-digit state FIPS for state-level rollups. */
  stateFips?: string[];
  /** ACS 5-year data publication year. Default = 2022 (latest at writing). */
  year?: number;
}

interface AcsAggregate {
  year: number;
  state_fips: string;
  county_fips: string | null;
  region_label: string;
  median_household_income: number | null;
  population: number | null;
  owner_occupied_pct: number | null;
  median_home_value: number | null;
  /** % of owner-occupied households spending >30% of income on housing. */
  cost_burdened_owners_pct: number | null;
  median_age: number | null;
  pct_bachelors_or_higher: number | null;
  fetched_at: string;
}

const CACHE_DAYS = 180;
const DEFAULT_YEAR = 2022;

const VARS = [
  'NAME',
  'B19013_001E', // Median household income (dollars)
  'B01003_001E', // Total population
  'B25003_002E', // Owner-occupied households
  'B25003_001E', // Total occupied housing units
  'B25077_001E', // Median value of owner-occupied housing units
  'B25091_008E', // Owner households with mortgage spending 30%+ on housing
  'B25091_001E', // Owner households with mortgage (total)
  'B01002_001E', // Median age
  'B15003_022E', // Bachelor's degree
  'B15003_023E', // Master's degree
  'B15003_024E', // Professional degree
  'B15003_025E', // Doctorate
  'B15003_001E'  // Total age 25+
].join(',');

function isCensusAcsConfig(c: unknown): c is CensusAcsConfig {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (o.countyFips !== undefined && !(Array.isArray(o.countyFips) && o.countyFips.every((s) => typeof s === 'string'))) return false;
  if (o.stateFips !== undefined && !(Array.isArray(o.stateFips) && o.stateFips.every((s) => typeof s === 'string'))) return false;
  if (o.year !== undefined && typeof o.year !== 'number') return false;
  return true;
}

function num(s: string | null | undefined): number | null {
  if (s == null) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function pct(num: number | null, den: number | null): number | null {
  if (num == null || den == null || den <= 0) return null;
  return Math.round((num / den) * 1000) / 10; // 1 decimal
}

async function fetchCounty(year: number, stateFips: string, countyFips?: string): Promise<AcsAggregate | null> {
  const params = new URLSearchParams();
  params.set('get', VARS);
  if (countyFips) {
    params.set('for', `county:${countyFips.slice(2)}`);
    params.set('in', `state:${stateFips}`);
  } else {
    params.set('for', `state:${stateFips}`);
  }
  const key = process.env.CENSUS_API_KEY;
  if (key) params.set('key', key);
  const url = `https://api.census.gov/data/${year}/acs/acs5?${params.toString()}`;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'AtlanticHub/1.0 (research)' }
    });
    if (!res.ok) return null;
    // Census returns [headerRow, dataRow]
    const j = (await res.json()) as string[][];
    if (!Array.isArray(j) || j.length < 2) return null;
    const headers = j[0];
    const row = j[1];
    const idx = (h: string) => headers.indexOf(h);

    const name = row[idx('NAME')] ?? '';
    const medianHHI = num(row[idx('B19013_001E')]);
    const population = num(row[idx('B01003_001E')]);
    const ownerOcc = num(row[idx('B25003_002E')]);
    const totalOcc = num(row[idx('B25003_001E')]);
    const medianValue = num(row[idx('B25077_001E')]);
    const burdened = num(row[idx('B25091_008E')]);
    const mortHouseholds = num(row[idx('B25091_001E')]);
    const medianAge = num(row[idx('B01002_001E')]);
    const bachelors = num(row[idx('B15003_022E')]) ?? 0;
    const masters = num(row[idx('B15003_023E')]) ?? 0;
    const prof = num(row[idx('B15003_024E')]) ?? 0;
    const doc = num(row[idx('B15003_025E')]) ?? 0;
    const total25 = num(row[idx('B15003_001E')]);

    return {
      year,
      state_fips: stateFips,
      county_fips: countyFips ?? null,
      region_label: name,
      median_household_income: medianHHI,
      population,
      owner_occupied_pct: pct(ownerOcc, totalOcc),
      median_home_value: medianValue,
      cost_burdened_owners_pct: pct(burdened, mortHouseholds),
      median_age: medianAge,
      pct_bachelors_or_higher: pct(bachelors + masters + prof + doc, total25),
      fetched_at: new Date().toISOString()
    };
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

export const censusAcsAdapter: PublicIntelAdapter = {
  kind: 'census_acs',
  displayName: 'Census ACS (income / tenure / housing)',
  description:
    'Tract-level household income, owner-occupied percentage, median home value, cost-burdened owner share, education from the American Community Survey 5-year. The denominator under HMDA — pairs with it for "stretched owners with mortgage activity" targeting.',
  requiresKey: false,
  apiKeyEnv: 'CENSUS_API_KEY',
  costNote: 'Free · Census Bureau API · 500 req/day without key, unlimited with',
  bestFor: ['Marty (consumer loans)', 'Real estate', 'Local services'],

  validateConfig(config) {
    if (config == null) return null;
    if (!isCensusAcsConfig(config)) {
      return 'config must be { countyFips?: string[], stateFips?: string[], year?: number }';
    }
    const c: CensusAcsConfig = config;
    const hasCounty = Array.isArray(c.countyFips) && c.countyFips.length > 0;
    const hasState = Array.isArray(c.stateFips) && c.stateFips.length > 0;
    if (!hasCounty && !hasState) return 'set either countyFips[] (5-digit FIPS) or stateFips[] (2-digit FIPS)';
    if (c.year !== undefined && (c.year < 2010 || c.year > DEFAULT_YEAR)) {
      return `year must be between 2010 and ${DEFAULT_YEAR}`;
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
    const cfg: CensusAcsConfig = (cfgRaw as CensusAcsConfig | null) ?? {};
    const year = cfg.year ?? DEFAULT_YEAR;
    const targets: Array<{ stateFips: string; countyFips?: string }> = [];
    for (const c of cfg.countyFips ?? []) {
      const st = c.slice(0, 2);
      if (st.length === 2) targets.push({ stateFips: st, countyFips: c });
    }
    for (const st of cfg.stateFips ?? []) targets.push({ stateFips: st });

    let written = 0;
    let fromCache = 0;
    const errors: string[] = [];

    for (const t of targets) {
      const entityKey = `census_acs:${year}:${t.countyFips ?? `state-${t.stateFips}`}`;
      const cached = await findCachedRecord<AcsAggregate>('census_acs', entityKey);
      if (cached) {
        fromCache++;
        continue;
      }
      const agg = await fetchCounty(year, t.stateFips, t.countyFips);
      if (!agg) {
        errors.push(entityKey);
        continue;
      }
      const summary = `${agg.region_label}: median HHI $${(agg.median_household_income ?? 0).toLocaleString()}, ${agg.owner_occupied_pct ?? '?'}% owner-occupied`;
      const expires = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000);
      await storeRecord<AcsAggregate>({
        sourceKind: 'census_acs',
        entityKey,
        clientId: ctx.clientId ?? ctx.source.clientId,
        leadId: ctx.leadId ?? null,
        recordJson: agg,
        summaryLabel: summary.slice(0, 240),
        regionCode: t.countyFips ?? t.stateFips,
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
