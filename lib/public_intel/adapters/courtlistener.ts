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
  /** (#528, val 2026-06-08) When set, runs name-targeted full-text search via
   *  fetchByName instead of the state-aggregate sweep. Each matching docket
   *  becomes its own public_intel_record keyed by docket URL — so the
   *  Intelligence Feed shows the person's actual cases, not random state filings. */
  name?: string;
  /** When in name-lookup mode, max hits to fetch. Default 25, cap 100. */
  maxResults?: number;
}

interface CourtListenerHit {
  filedAt: string | null;
  caseName: string | null;
  caseNameShort: string | null;
  court: string | null;
  courtId: string | null;
  natureOfSuit: string | null;
  docketUrl: string | null;
  docketNumber: string | null;
  party: string | null;
  parties: string[] | null;
  attorney: string[] | null;
  /** Bankruptcy chapter (7 / 11 / 13) when present — drives the consumer
   *  vs corporate signal split for the distress engine. */
  chapter: string | null;
  /** Magistrate / assigned judge label when CourtListener returns it. */
  assignedTo: string | null;
  juryDemand: string | null;
  dateTerminated: string | null;
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
  if (o.name !== undefined && typeof o.name !== 'string') return false;
  if (o.maxResults !== undefined && typeof o.maxResults !== 'number') return false;
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
        dateTerminated?: string;
        caseName?: string;
        caseNameShort?: string;
        court?: string;
        court_id?: string;
        suitNature?: string;
        absolute_url?: string;
        docketNumber?: string;
        docket_number?: string;
        party?: string[];
        attorney?: string[];
        chapter?: string | number;
        assignedTo?: string;
        juryDemand?: string;
        court_state?: string;
      }>;
    };
    return (j.results ?? []).map((r) => ({
      filedAt: r.dateFiled ?? null,
      caseName: r.caseName ?? null,
      caseNameShort: r.caseNameShort ?? null,
      court: r.court ?? null,
      courtId: r.court_id ?? null,
      natureOfSuit: r.suitNature ?? null,
      docketUrl: r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : null,
      docketNumber: r.docketNumber ?? r.docket_number ?? null,
      party: Array.isArray(r.party) ? r.party.join(' / ') : null,
      parties: Array.isArray(r.party) ? r.party : null,
      attorney: Array.isArray(r.attorney) ? r.attorney : null,
      chapter: r.chapter != null ? String(r.chapter) : null,
      assignedTo: r.assignedTo ?? null,
      juryDemand: r.juryDemand ?? null,
      dateTerminated: r.dateTerminated ?? null,
      state: r.court_state ?? state.toUpperCase()
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(tid);
  }
}

/**
 * (#526, val 2026-06-08) Fetch federal filings that mention a specific
 * person or company by name. Uses CourtListener's `q=` full-text parameter
 * (quoted to keep multi-word names intact). Returns up to maxResults hits.
 *
 * Per the no-duct-tape rule: this replaces the manual-URL pattern in the
 * KYC sweep with a real name-targeted lookup. Each hit becomes its own
 * public_intel_records row in the caller.
 */
export async function fetchByName(
  name: string,
  maxResults = 25,
  sinceDays?: number,
  states?: string[]
): Promise<CourtListenerHit[]> {
  const params = new URLSearchParams();
  params.set('type', 'r');
  // Quoted phrase match — exact "Mark Francis" not "mark" OR "francis"
  params.set('q', `"${name.replace(/"/g, '\\"')}"`);
  params.set('order_by', 'dateFiled desc');
  params.set('page_size', String(Math.min(maxResults, 100)));
  if (sinceDays && sinceDays > 0) {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    params.set('filed_after', yyyymmdd(since));
  }
  // (#528b, val 2026-06-08) Scope to user's states when provided. Critical for
  // common names like "Mark Francis" — without state scoping val gets 7 different
  // Mark Francises across the country (Dumas in RI, Zmuda in AZ, Buchholz in FL).
  if (states && states.length > 0) {
    for (const s of states) params.append('court_state', s.toUpperCase());
  }
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
        dateTerminated?: string;
        caseName?: string;
        caseNameShort?: string;
        court?: string;
        court_id?: string;
        suitNature?: string;
        absolute_url?: string;
        docketNumber?: string;
        docket_number?: string;
        party?: string[];
        attorney?: string[];
        chapter?: string | number;
        assignedTo?: string;
        juryDemand?: string;
        court_state?: string;
      }>;
    };
    // Defense: free-text search drags in substrings. CourtListener's q= for
    // "Mark Francis" returns "Mark Francis Dumas", "Mark Francis Zmuda" etc.
    // because "Mark Francis" appears as first+middle in those names.
    // We tighten to: the queried phrase must appear with a word boundary on
    // BOTH sides in a party entry — OR appear as an exact party match — OR
    // the case name contains it as a non-embedded phrase ("Smith v. Mark Francis"
    // is fine; "Mark Francis Dumas v. Acme" is not).
    const needle = name.toLowerCase().trim();
    const tokenCount = needle.split(/\s+/).length;
    const tightMatch = (haystack: string): boolean => {
      const hay = haystack.toLowerCase();
      if (!hay.includes(needle)) return false;
      // Require word-boundary AND no additional name tokens immediately after.
      // "Mark Francis Dumas" → after match, next char is " D" → reject (additional name token).
      // "Mark Francis v. Acme" → after match, next chars are " v." → accept (court syntax, not a name).
      const idx = hay.indexOf(needle);
      const before = idx === 0 ? '' : hay[idx - 1];
      const after = hay.slice(idx + needle.length);
      // Reject if preceded by a letter (means substring of bigger word).
      if (before && /[a-z]/.test(before)) return false;
      // Reject if followed by " <Capitalizedword>" where the word is letters
      // only — that's a continued name. Allow if followed by punctuation,
      // end-of-string, OR a court-syntax word (v., et al, jr, sr, iii).
      const trimmedAfter = after.trim();
      if (trimmedAfter === '') return true;
      const COURT_OK = /^(v\.|vs\.|et\s+al|jr\.?|sr\.?|iii|ii|iv|in\s+re)/i;
      if (COURT_OK.test(trimmedAfter)) return true;
      // Otherwise — does the next word look like another name? Any word that
      // starts with a letter and is ≥2 chars long. That indicates a 3rd name
      // token like "Dumas" → reject.
      const nextWord = trimmedAfter.match(/^([a-z]{2,})/i);
      if (nextWord) return false;
      return true;
    };
    return (j.results ?? [])
      .map((r) => ({
        filedAt: r.dateFiled ?? null,
        caseName: r.caseName ?? null,
        caseNameShort: r.caseNameShort ?? null,
        court: r.court ?? null,
        courtId: r.court_id ?? null,
        natureOfSuit: r.suitNature ?? null,
        docketUrl: r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : null,
        docketNumber: r.docketNumber ?? r.docket_number ?? null,
        party: Array.isArray(r.party) ? r.party.join(' / ') : null,
        parties: Array.isArray(r.party) ? r.party : null,
        attorney: Array.isArray(r.attorney) ? r.attorney : null,
        chapter: r.chapter != null ? String(r.chapter) : null,
        assignedTo: r.assignedTo ?? null,
        juryDemand: r.juryDemand ?? null,
        dateTerminated: r.dateTerminated ?? null,
        state: r.court_state ?? null
      }))
      .filter((h) => {
        // Reference tokenCount to keep the symbol live for future tuning.
        void tokenCount;
        if (tightMatch(h.caseName ?? '')) return true;
        if (tightMatch(h.party ?? '')) return true;
        // Also check individual party array entries (caseName may strip middle names).
        if (Array.isArray(h.parties)) {
          for (const p of h.parties) {
            if (tightMatch(p ?? '')) return true;
          }
        }
        return false;
      });
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
    if (!isCfg(config)) return 'config must be { states?: string[], natureOfSuit?: string[], sinceDays?: number, name?: string, maxResults?: number }';
    const c = config as CourtListenerConfig;
    // (#528) Name-targeted lookup is nationwide — states[] is optional in that mode.
    const isNameLookup = typeof c.name === 'string' && c.name.trim().length > 0;
    if (!isNameLookup && (!c.states || c.states.length === 0)) {
      return 'set at least one state in states[] (or set name for nationwide person/entity lookup)';
    }
    if (c.maxResults !== undefined && (c.maxResults < 1 || c.maxResults > 100)) {
      return 'maxResults must be between 1 and 100';
    }
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
    const nameLookup = (cfg.name ?? '').trim();
    const maxResults = cfg.maxResults ?? 25;

    let written = 0;
    let fromCache = 0;
    const errors: string[] = [];

    // (#528) Name-targeted lookup: filter dockets by entity name and persist
    // each match as its own record. Replaces the state-aggregate noise pattern
    // (those random VA/WI/DE bankruptcies that aren't related to the subject).
    if (nameLookup) {
      const slug = nameLookup.toLowerCase().replace(/\s+/g, '_').slice(0, 80);
      const aggKey = `courtlistener:name:lookup:${slug}:${sinceDays || 'all'}d`;
      const cached = await findCachedRecord<{ hits: CourtListenerHit[] }>('courtlistener', aggKey);
      if (cached) {
        fromCache = 1;
      } else {
        const hits = await fetchByName(
          nameLookup,
          maxResults,
          sinceDays || undefined,
          cfg.states && cfg.states.length > 0 ? cfg.states : undefined
        );
        const expires = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000);
        // Roll-up record so the panel sees a "lookup ran" entry even on zero
        await storeRecord<{ query: string; hits: CourtListenerHit[]; total: number }>({
          sourceKind: 'courtlistener',
          entityKey: aggKey,
          clientId: ctx.clientId ?? ctx.source.clientId,
          recordJson: { query: nameLookup, hits, total: hits.length },
          summaryLabel: hits.length > 0
            ? `${hits.length} federal filing${hits.length === 1 ? '' : 's'} naming "${nameLookup}"`
            : `0 federal filings naming "${nameLookup}" — clean signal`,
          regionCode: null,
          expiresAt: expires
        });
        written++;
        for (const h of hits) {
          const docketSlug = (h.docketUrl ?? `${h.court ?? ''}/${h.caseName ?? ''}/${h.docketNumber ?? ''}`)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .slice(0, 180);
          await storeRecord<CourtListenerHit & { matched_query: string }>({
            sourceKind: 'courtlistener',
            entityKey: `courtlistener:name:${docketSlug}`,
            clientId: ctx.clientId ?? ctx.source.clientId,
            recordJson: { ...h, matched_query: nameLookup },
            summaryLabel: `${h.caseName ?? 'Unknown case'} · ${h.court ?? ''} · ${h.filedAt ?? ''}`.slice(0, 240),
            regionCode: h.state,
            expiresAt: expires
          });
          written++;
        }
      }
      const detail = `Name "${nameLookup}": ${written} fetched, ${fromCache} from cache`;
      await noteRun({ sourceId: ctx.source.sourceId, status: 'ok', detail });
      return { ok: true, written, fromCache, detail };
    }

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
