/**
 * lib/public_intel/adapters/cfpb.ts  (#370, val 2026-06-02)
 *
 * Consumer Financial Protection Bureau — public complaint database. Every
 * complaint a US consumer files against a financial-services company,
 * indexed by company, product, state, zip. Free JSON API, no key.
 *
 * For Marty (consumer loans): tells him which lenders are under fire in
 * which markets — and gives him pre-mapped pain points to lead conversations
 * with. ("Wells Fargo just took 47 mortgage complaints in your zip last
 * quarter. Want a clean alternative?")
 *
 * For Adriana (CLDA): complaints about debt collection / mortgage / credit
 * reporting in CA help triangulate distress neighborhoods.
 *
 * API docs: https://cfpb.github.io/api/ccdb/
 * Endpoint shape:
 *   https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/
 *   ?state=FL&size=0&aggs=company&aggs=product
 * Returns Elasticsearch-style aggregations we can use without pulling raw rows.
 */
import type { PublicIntelAdapter, RunContext, RunResult } from '../types';
import { storeRecord, findCachedRecord, noteRun } from '../store';

interface CfpbConfig {
  /** US state postal codes ("FL", "CA"). */
  states?: string[];
  /** Optional product filter ("Mortgage", "Credit reporting"). */
  products?: string[];
  /** How many days back to aggregate. Default 90. */
  sinceDays?: number;
  /** (#526, val 2026-06-08) When set, switches from aggregate-state mode to
   *  company-name-specific lookup. Returns up to maxResults INDIVIDUAL
   *  complaints filed against the named company in the given state(s).
   *  Fulfills the KYC use case where val wants "what complaints exist
   *  against THIS company" not "what's the state-wide aggregate". */
  company?: string;
  /** When in company-lookup mode, how many specific complaints to fetch.
   *  Default 25, max 100. Each complaint becomes its own public_intel_record. */
  maxResults?: number;
}

interface CfpbAggregate {
  state: string;
  product_filter: string | null;
  since_days: number;
  total_complaints: number;
  top_companies: Array<{ company: string; count: number }>;
  top_products: Array<{ product: string; count: number }>;
  top_issues: Array<{ issue: string; count: number }>;
  fetched_at: string;
}

/** (#526) Single CFPB complaint, returned when company= filter is set. */
interface CfpbComplaint {
  complaint_id: string;
  company: string;
  product: string;
  sub_product: string | null;
  issue: string;
  sub_issue: string | null;
  state: string | null;
  zip_code: string | null;
  date_received: string;
  company_response: string | null;
  timely_response: string | null;
  consumer_disputed: string | null;
  complaint_what_happened: string | null;
  fetched_at: string;
}

const CACHE_DAYS = 14;
const ENDPOINT = 'https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/';

function isCfpbConfig(c: unknown): c is CfpbConfig {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (o.states !== undefined && !(Array.isArray(o.states) && o.states.every((s) => typeof s === 'string'))) return false;
  if (o.products !== undefined && !(Array.isArray(o.products) && o.products.every((s) => typeof s === 'string'))) return false;
  if (o.sinceDays !== undefined && typeof o.sinceDays !== 'number') return false;
  if (o.company !== undefined && typeof o.company !== 'string') return false;
  if (o.maxResults !== undefined && typeof o.maxResults !== 'number') return false;
  return true;
}

/**
 * (#526) Fetch INDIVIDUAL CFPB complaints filtered by company name.
 * Used when val wants "what complaints exist against THIS company" — the
 * KYC use case. The CFPB search API supports a `company=` parameter that
 * does a fuzzy match on the consumer-disclosed company name. Returns up to
 * maxResults complaints (capped at 100).
 *
 * Per the no-duct-tape rule: this is the REAL lookup, not a manual URL.
 */
export async function fetchByCompany(
  company: string,
  states: string[],
  sinceDays: number,
  maxResults: number
): Promise<CfpbComplaint[]> {
  const params = new URLSearchParams();
  params.set('company', company);
  params.set('size', String(Math.min(maxResults, 100)));
  params.set('sort', 'created_date_desc');
  const dateMin = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  params.set('date_received_min', yyyymmdd(dateMin));
  for (const s of states) params.append('state', s.toUpperCase());

  const url = `${ENDPOINT}?${params.toString()}`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'AtlanticHub/1.0 (research)' }
    });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      hits?: { hits?: Array<{ _source?: Record<string, unknown>; _id?: string }> };
    };
    const hits = j.hits?.hits ?? [];
    const out: CfpbComplaint[] = [];
    for (const h of hits) {
      const s = h._source ?? {};
      const get = (k: string): string | null => {
        const v = (s as Record<string, unknown>)[k];
        return v == null ? null : String(v);
      };
      out.push({
        complaint_id: get('complaint_id') ?? h._id ?? '',
        company: get('company') ?? company,
        product: get('product') ?? '',
        sub_product: get('sub_product'),
        issue: get('issue') ?? '',
        sub_issue: get('sub_issue'),
        state: get('state'),
        zip_code: get('zip_code'),
        date_received: get('date_received') ?? '',
        company_response: get('company_response'),
        timely_response: get('timely'),
        consumer_disputed: get('consumer_disputed'),
        complaint_what_happened: get('complaint_what_happened'),
        fetched_at: new Date().toISOString()
      });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(tid);
  }
}

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchAggregate(state: string, products: string[] | undefined, sinceDays: number): Promise<CfpbAggregate | null> {
  const params = new URLSearchParams();
  params.set('state', state.toUpperCase());
  params.set('size', '0');
  params.append('aggs', 'company');
  params.append('aggs', 'product');
  params.append('aggs', 'issue');
  const dateMin = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  params.set('date_received_min', yyyymmdd(dateMin));
  for (const p of products ?? []) params.append('product', p);

  const url = `${ENDPOINT}?${params.toString()}`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'AtlanticHub/1.0 (research)' }
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      hits?: { total?: { value?: number } | number };
      aggregations?: {
        company?: { company?: { buckets?: Array<{ key: string; doc_count: number }> } };
        product?: { product?: { buckets?: Array<{ key: string; doc_count: number }> } };
        issue?: { issue?: { buckets?: Array<{ key: string; doc_count: number }> } };
      };
    };
    const total =
      typeof j.hits?.total === 'object' && j.hits.total
        ? Number(j.hits.total.value ?? 0)
        : typeof j.hits?.total === 'number'
          ? j.hits.total
          : 0;
    const companies = j.aggregations?.company?.company?.buckets ?? [];
    const productsBuckets = j.aggregations?.product?.product?.buckets ?? [];
    const issuesBuckets = j.aggregations?.issue?.issue?.buckets ?? [];
    return {
      state: state.toUpperCase(),
      product_filter: (products ?? []).join('|') || null,
      since_days: sinceDays,
      total_complaints: total,
      top_companies: companies.slice(0, 10).map((b) => ({ company: b.key, count: b.doc_count })),
      top_products: productsBuckets.slice(0, 10).map((b) => ({ product: b.key, count: b.doc_count })),
      top_issues: issuesBuckets.slice(0, 10).map((b) => ({ issue: b.key, count: b.doc_count })),
      fetched_at: new Date().toISOString()
    };
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

export const cfpbAdapter: PublicIntelAdapter = {
  kind: 'cfpb',
  displayName: 'CFPB consumer complaints',
  description:
    'Every complaint a US consumer has filed against a bank, lender, or credit reporter, by state + product + issue. Gold companion to HMDA — tells you which lenders are under fire in which markets.',
  requiresKey: false,
  costNote: 'Free · CFPB public Socrata API · no rate limit issues at SMB scale',
  // (val 2026-06-06, honesty pass) CFPB surfaces complaints AGAINST financial
  // companies (lenders/servicers), NOT businesses that need a collector. So it
  // fits CONSUMER LENDING, not Adriana's collections — removing that misleading
  // "best for" so the panel stops implying it's a CBB/collections source.
  bestFor: ['Marty (consumer lending)', 'Banking / credit advisors'],

  validateConfig(config) {
    if (config == null) return null;
    if (!isCfpbConfig(config)) {
      return 'config must be { states?: string[], products?: string[], sinceDays?: number, company?: string, maxResults?: number }';
    }
    const c: CfpbConfig = config;
    // (#526) Company-lookup mode doesn't require a state — nationwide search.
    const isLookup = typeof c.company === 'string' && c.company.trim().length > 0;
    if (!isLookup && (!c.states || c.states.length === 0)) {
      return 'set at least one state in states[] (or set company to do nationwide lookup)';
    }
    if (c.sinceDays !== undefined && (c.sinceDays < 1 || c.sinceDays > 1825)) {
      return 'sinceDays must be between 1 and 1825 (5 years)';
    }
    if (c.maxResults !== undefined && (c.maxResults < 1 || c.maxResults > 100)) {
      return 'maxResults must be between 1 and 100';
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
    const cfg: CfpbConfig = (cfgRaw as CfpbConfig | null) ?? {};
    const states = (cfg.states ?? []).map((s) => s.toUpperCase());
    const products = cfg.products && cfg.products.length > 0 ? cfg.products : undefined;
    const sinceDays = cfg.sinceDays ?? 90;
    const productKey = products ? products.join(',') : 'all';
    const companyLookup = (cfg.company ?? '').trim();
    const maxResults = cfg.maxResults ?? 25;

    let written = 0;
    let fromCache = 0;
    const errors: string[] = [];

    // (#526) Company-lookup mode: filter by specific company name + persist
    // each individual complaint as its own record (not the state aggregate).
    if (companyLookup) {
      const entityKeyBase = `cfpb:company:${companyLookup.toLowerCase().replace(/\s+/g, '_').slice(0, 80)}:${sinceDays}d`;
      const cached = await findCachedRecord<{ complaints: CfpbComplaint[] }>('cfpb', entityKeyBase);
      if (cached) {
        fromCache = 1;
      } else {
        const complaints = await fetchByCompany(companyLookup, states, sinceDays, maxResults);
        const expires = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000);
        // Store one aggregate "lookup roll-up" record so cache works, AND
        // store each complaint individually so Intelligence Feed shows them.
        await storeRecord<{ complaints: CfpbComplaint[]; query: string; total: number }>({
          sourceKind: 'cfpb',
          entityKey: entityKeyBase,
          clientId: ctx.clientId ?? ctx.source.clientId,
          leadId: ctx.leadId ?? null,
          recordJson: { complaints, query: companyLookup, total: complaints.length },
          summaryLabel: `${complaints.length} CFPB complaint${complaints.length === 1 ? '' : 's'} against "${companyLookup}" / ${sinceDays}d`.slice(0, 240),
          regionCode: states[0] ?? null,
          expiresAt: expires
        });
        written++;
        for (const c of complaints) {
          if (!c.complaint_id) continue;
          await storeRecord<CfpbComplaint>({
            sourceKind: 'cfpb',
            entityKey: `cfpb:complaint:${c.complaint_id}`,
            clientId: ctx.clientId ?? ctx.source.clientId,
            leadId: ctx.leadId ?? null,
            recordJson: c,
            summaryLabel: `${c.product}${c.sub_product ? ' / ' + c.sub_product : ''} — ${c.issue}${c.state ? ' (' + c.state + ')' : ''}`.slice(0, 240),
            regionCode: c.state,
            expiresAt: expires
          });
          written++;
        }
      }
      const detail = `Company "${companyLookup}": ${written} fetched, ${fromCache} from cache`;
      await noteRun({ sourceId: ctx.source.sourceId, status: 'ok', detail });
      return { ok: true, written, fromCache, detail };
    }

    for (const state of states) {
      const entityKey = `cfpb:${state}:${productKey}:${sinceDays}d`;
      const cached = await findCachedRecord<CfpbAggregate>('cfpb', entityKey);
      if (cached) {
        fromCache++;
        continue;
      }
      const agg = await fetchAggregate(state, products, sinceDays);
      if (!agg) {
        errors.push(state);
        continue;
      }
      const topCo = agg.top_companies[0]?.company ?? 'none';
      const summary = `${state}: ${agg.total_complaints.toLocaleString()} complaints / ${sinceDays}d · #1 ${topCo}`;
      const expires = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000);
      await storeRecord<CfpbAggregate>({
        sourceKind: 'cfpb',
        entityKey,
        clientId: ctx.clientId ?? ctx.source.clientId,
        leadId: ctx.leadId ?? null,
        recordJson: agg,
        summaryLabel: summary.slice(0, 240),
        regionCode: state,
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
