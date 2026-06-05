/**
 * lib/public_intel/adapters/courtlistener.ts  (#372, val 2026-06-03)
 *
 * CourtListener (free.law) — free, donor-supported mirror of PACER. Federal
 * district courts, appellate courts, and US Bankruptcy Court. JSON API,
 * no key required at low rates (a token raises the daily ceiling but is
 * optional).
 *
 * For CBB (collections): lawsuits filed + bankruptcies filed are the
 * highest-weighted distress signals per the advisor brief. This adapter is
 * literally the gold of the seven sources he named.
 *
 * For Adriana (CLDA): debt lawsuits + foreclosure proceedings show up in
 * federal courts when removed from state; complementary to county data.
 *
 * API docs: https://www.courtlistener.com/help/api/rest/
 * Endpoint:
 *   GET https://www.courtlistener.com/api/rest/v4/search/?type=r&q=...
 *   type=r is RECAP (federal court docket) data.
 *
 * Config:
 *   - states: filter by court state ("FL", "CA")
 *   - natureOfSuit: optional filter (e.g. "Contract: Other", "Bankruptcy")
 *   - sinceDays: lookback window. Default 14 days for fresh signals.
 */
import type { PublicIntelAdapter, RunContext, RunResult } from '../types';
import { storeRecord, findCachedRecord, noteRun } from '../store';

interface CourtListenerConfig {
  states?: string[];
  natureOfSuit?: string[];
  sinceDays?: number;
}

interface CourtListenerHit {
  filedAt: string | null;
  caseName: string | null;
  court: string | null;
  courtId: string | null;
  natureOfSuit: string | null;
  docketUrl: string | null;
  party: string | null;
  state: string | null;
}

const CACHE_DAYS = 1; // Fresh signal source — re-pull daily.
const ENDPOINT = 'https://www.courtlistener.com/api/rest/v4/search/';

function isCfg(c: unknown): c is CourtListenerConfig {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (o.states !== undefined && !(Array.isArray(o.states) && o.states.every((s) => typeof s === 'string'))) return false;
  if (o.natureOfSuit !== undefined && !(Array.isArray(o.natureOfSuit) && o.natureOfSuit.every((s) => typeof s === 'string'))) return false;
  if (o.sinceDays !== undefined && typeof o.sinceDays !== 'number') return false;
  return true;
}

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchHits(state: string, sinceDays: number, nature?: string[]): Promise<CourtListenerHit[]> {
  const params = new URLSearchParams();
  params.set('type', 'r'); // RECAP federal docket data
  params.set('court_state', state.toUpperCase());
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  params.set('filed_after', yyyymmdd(since));
  if (nature && nature.length > 0) params.set('nature_of_suit', nature.join(','));
  params.set('order_by', 'dateFiled desc');
  params.set('page_size', '50');

  const url = `${ENDPOINT}?${params.toString()}`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 25000);
  try {
    const token = process.env.COURTLISTENER_TOKEN;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'AtlanticHub/1.0 (research; contact: PR@api.atlanticandvine.com)'
    };
    if (token) headers.Authorization = `Token ${token}`;
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      results?: Array<{
        dateFiled?: string;
        caseName?: string;
        court?: string;
        court_id?: string;
        suitNature?: string;
        absolute_url?: string;
        party?: string[];
        court_state?: string;
      }>;
    };
    return (j.results ?? []).map((r) => ({
      filedAt: r.dateFiled ?? null,
      caseName: r.caseName ?? null,
      court: r.court ?? null,
      courtId: r.court_id ?? null,
      natureOfSuit: r.suitNature ?? null,
      docketUrl: r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : null,
      party: Array.isArray(r.party) ? r.party.join(' / ') : null,
      state: r.court_state ?? state.toUpperCase()
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Demo entrypoint (#372) — fetch federal filings for a single state directly,
 * bypassing the full adapter run/store pipeline. Used by /api/demo/run, the
 * public ZIP→signals demo. Returns the raw hits; the caller slices + shapes them.
 */
export async function runCourtListenerForDemo(
  state: string,
  sinceDays = 30
): Promise<CourtListenerHit[]> {
  return fetchHits(state.toUpperCase(), sinceDays);
}

export const courtListenerAdapter: PublicIntelAdapter = {
  kind: 'courtlistener', // not yet in PublicIntelKind union; cast for now
  displayName: 'CourtListener (federal courts + bankruptcy)',
  description:
    'Federal district + appellate + bankruptcy filings, geocoded by court state. The gold for collections / litigation prospecting. Free via free.law; optional token raises daily quota.',
  requiresKey: false,
  apiKeyEnv: 'COURTLISTENER_TOKEN',
  costNote: 'Free · CourtListener / free.law · optional token raises quota',
  bestFor: ['CBB (collections + recovery)', 'Adriana (CLDA — debt lawsuits)', 'Litigation-focused services'],

  validateConfig(config) {
    if (config == null) return null;
    if (!isCfg(config)) return 'config must be { states?: string[], natureOfSuit?: string[], sinceDays?: number }';
    const c = config as CourtListenerConfig;
    if (!c.states || c.states.length === 0) return 'set at least one state in states[]';
    if (c.sinceDays !== undefined && (c.sinceDays < 1 || c.sinceDays > 365)) {
      return 'sinceDays must be between 1 and 365';
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
    const cfg: CourtListenerConfig = (cfgRaw as CourtListenerConfig | null) ?? {};
    const sinceDays = cfg.sinceDays ?? 14;
    const natureKey = (cfg.natureOfSuit ?? []).join(',') || 'any';

    let written = 0;
    let fromCache = 0;
    const errors: string[] = [];

    for (const state of cfg.states ?? []) {
      const stateUp = state.toUpperCase();
      const aggKey = `courtlistener:agg:${stateUp}:${natureKey}:${sinceDays}d`;
      const cached = await findCachedRecord<{ hits: CourtListenerHit[] }>('courtlistener', aggKey);
      if (cached) {
        fromCache++;
        continue;
      }
      const hits = await fetchHits(stateUp, sinceDays, cfg.natureOfSuit);
      if (hits.length === 0) {
        errors.push(stateUp);
        continue;
      }
      const expires = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000);
      // Aggregate record so the watchlist can browse "what came in for FL last 14d."
      await storeRecord<{ state: string; sinceDays: number; hits: CourtListenerHit[] }>({
        sourceKind: 'courtlistener',
        entityKey: aggKey,
        clientId: ctx.clientId ?? ctx.source.clientId,
        recordJson: { state: stateUp, sinceDays, hits },
        summaryLabel: `${stateUp} · ${hits.length} federal filings / ${sinceDays}d`,
        regionCode: stateUp,
        expiresAt: expires
      });
      written++;

      // Per-filing rows so the distress engine can classify each one separately.
      for (const h of hits.slice(0, 200)) {
        if (!h.caseName) continue;
        const id = (h.docketUrl ?? `${h.court ?? ''}/${h.caseName}`)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .slice(0, 200);
        await storeRecord<CourtListenerHit & { entity: string; nature: string | null }>({
          sourceKind: 'courtlistener',
          entityKey: `entity:courtlistener:${id}`,
          clientId: ctx.clientId ?? ctx.source.clientId,
          recordJson: { ...h, entity: h.caseName ?? '', nature: h.natureOfSuit },
          summaryLabel: `${h.caseName?.slice(0, 200)} · ${h.court ?? ''} · ${h.filedAt ?? ''}`,
          regionCode: h.state ?? stateUp,
          expiresAt: expires
        });
      }
    }

    const detail = `${written} aggregates fetched, ${fromCache} from cache, ${errors.length} states empty`;
    await noteRun({
      sourceId: ctx.source.sourceId,
      status: errors.length > 0 && written === 0 ? 'error' : 'ok',
      detail
    });
    return { ok: written > 0 || fromCache > 0, written, fromCache, detail };
  }
};
