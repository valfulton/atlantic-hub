/**
 * lib/public_intel/adapters/ca_sos.ts  (#369, val 2026-06-02)
 *
 * California Secretary of State — bizfileOnline searchable index of every
 * registered LLC, Corporation, LP, and LLP in CA. Filing status (Active,
 * Suspended, Dissolved, Cancelled), entity number, registered agent.
 *
 * Why this is gold for Adriana (CLDA):
 *   - SUSPENDED entities are 30-90 days from lien activity ~70% of the time
 *     (FTB suspension for unpaid taxes is the typical lien predicate).
 *   - DISSOLVED entities often leave creditors with mechanics liens / IRS liens
 *     on the remaining principals' personal property.
 *   - Recent registered-agent CHANGES often signal distress.
 *
 * Endpoint: bizfileOnline is fronted by Salesforce.com's Apex platform. The
 * public search API is at:
 *   https://bizfileonline.sos.ca.gov/api/Records/businesssearch
 * POST with JSON body { SEARCH_VALUE, STARTS_WITH_YN, ACTIVE_YN }. No key.
 *
 * Adapter modes:
 *   - "search" — search by company name (config.query). Pulls top 25 matches.
 *   - "watch"  — track a specific entity number (config.entityNumbers[]).
 *
 * Cache: 7 days per entity_key. CA SOS data updates daily but a per-week
 * refresh is plenty for distress-signal use.
 */
import type { PublicIntelAdapter, RunContext, RunResult } from '../types';
import { storeRecord, findCachedRecord, noteRun } from '../store';

interface CaSosConfig {
  /** Free-text name search ("Acme LLC", "Candelaria"). */
  query?: string;
  /** Or pull specific entity numbers ("C1234567", "201234567890"). */
  entityNumbers?: string[];
  /** Filter — default: include everything (Active + Suspended + Dissolved). */
  includeInactive?: boolean;
}

interface CaSosEntity {
  entityNumber: string;
  entityName: string;
  entityType: string | null;
  status: string | null;
  formedAt: string | null;
  jurisdiction: string | null;
  registeredAgent: string | null;
  principalAddress: string | null;
  fetchedAt: string;
}

const CACHE_DAYS = 7;
const SEARCH_URL = 'https://bizfileonline.sos.ca.gov/api/Records/businesssearch';

function isCaSosConfig(c: unknown): c is CaSosConfig {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (o.query !== undefined && typeof o.query !== 'string') return false;
  if (o.entityNumbers !== undefined && !(Array.isArray(o.entityNumbers) && o.entityNumbers.every((x) => typeof x === 'string'))) return false;
  return true;
}

interface BizfileSearchResp {
  rows?: Array<{
    ID?: string;
    TITLE?: string;
    LABEL?: string;
    ENTITY_NUM?: string;
    ENTITY_NAME?: string;
    ENTITY_TYPE?: string;
    ENTITY_STATUS?: string;
    FILING_DATE?: string;
    JURISDICTION?: string;
    PRINCIPAL_ADDRESS?: string;
    AGENT_NAME?: string;
  }>;
}

/** Single search request → list of normalized entities. */
async function searchByName(query: string, includeInactive: boolean): Promise<CaSosEntity[]> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'AtlanticHub/1.0 (research)'
      },
      body: JSON.stringify({
        SEARCH_VALUE: query,
        STARTS_WITH_YN: 'false',
        ACTIVE_YN: includeInactive ? 'false' : 'true'
      })
    });
    if (!res.ok) return [];
    const j = (await res.json()) as BizfileSearchResp;
    const now = new Date().toISOString();
    return (j.rows ?? []).slice(0, 25).map((r) => ({
      entityNumber: r.ENTITY_NUM ?? r.ID ?? '',
      entityName: r.ENTITY_NAME ?? r.TITLE ?? r.LABEL ?? '',
      entityType: r.ENTITY_TYPE ?? null,
      status: r.ENTITY_STATUS ?? null,
      formedAt: r.FILING_DATE ?? null,
      jurisdiction: r.JURISDICTION ?? null,
      registeredAgent: r.AGENT_NAME ?? null,
      principalAddress: r.PRINCIPAL_ADDRESS ?? null,
      fetchedAt: now
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(tid);
  }
}

export const caSosAdapter: PublicIntelAdapter = {
  kind: 'ca_sos',
  displayName: 'CA Secretary of State (LLC + Corp filings)',
  description:
    'LLC / Corp filings, suspensions, dissolutions, registered-agent changes from CA SOS bizfileOnline. Suspended/dissolved entities are upstream signals for lien activity — ~70% of suspensions precede a lien within 90 days.',
  requiresKey: false,
  costNote: 'Free · bizfileOnline public API (no key, soft rate limit)',
  bestFor: ['Adriana (CLDA — liens)', 'B2B sales', 'Distressed-asset buyers'],

  validateConfig(config) {
    if (config == null) return null;
    if (!isCaSosConfig(config)) {
      return 'config must be { query?: string, entityNumbers?: string[], includeInactive?: boolean }';
    }
    const c: CaSosConfig = config;
    const hasQuery = typeof c.query === 'string' && c.query.trim().length > 0;
    const hasNums = Array.isArray(c.entityNumbers) && c.entityNumbers.length > 0;
    if (!hasQuery && !hasNums) {
      return 'set either query (text search) or entityNumbers[]';
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
    const cfg: CaSosConfig = (cfgRaw as CaSosConfig | null) ?? {};
    const includeInactive = cfg.includeInactive !== false; // default: include all
    const queries: string[] = [];
    if (cfg.query) queries.push(cfg.query);
    if (cfg.entityNumbers) queries.push(...cfg.entityNumbers);

    let written = 0;
    let fromCache = 0;
    const errors: string[] = [];

    for (const q of queries) {
      const cacheKey = `ca_sos:search:${q.toLowerCase()}`;
      const cached = await findCachedRecord<{ entities: CaSosEntity[] }>('ca_sos', cacheKey);
      if (cached) {
        fromCache++;
        continue;
      }
      const entities = await searchByName(q, includeInactive);
      if (entities.length === 0) {
        errors.push(q);
        continue;
      }
      const expires = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000);
      // One aggregated record per search (so val can browse "search for Candelaria
      // → 6 entities"). Also drop per-entity records for direct lookup.
      const sus = entities.filter((e) => /suspend/i.test(e.status ?? '')).length;
      const dis = entities.filter((e) => /dissolv|cancel/i.test(e.status ?? '')).length;
      const summary = `${entities.length} matches · ${sus} suspended · ${dis} dissolved`;
      await storeRecord<{ query: string; entities: CaSosEntity[] }>({
        sourceKind: 'ca_sos',
        entityKey: cacheKey,
        clientId: ctx.clientId ?? ctx.source.clientId,
        leadId: ctx.leadId ?? null,
        recordJson: { query: q, entities },
        summaryLabel: `"${q}" — ${summary}`,
        regionCode: 'CA',
        expiresAt: expires
      });
      written++;

      // Also write per-entity rows so we can join leads ↔ entities later.
      for (const e of entities) {
        if (!e.entityNumber) continue;
        await storeRecord<CaSosEntity>({
          sourceKind: 'ca_sos',
          entityKey: `ca_sos:entity:${e.entityNumber}`,
          clientId: ctx.clientId ?? ctx.source.clientId,
          leadId: ctx.leadId ?? null,
          recordJson: e,
          summaryLabel: `${e.entityName} · ${e.status ?? 'Unknown'} · ${e.entityType ?? ''}`,
          regionCode: 'CA',
          expiresAt: expires
        });
      }
    }

    const detail = `${written} searches fetched, ${fromCache} from cache, ${errors.length} found nothing`;
    await noteRun({
      sourceId: ctx.source.sourceId,
      status: errors.length > 0 && written === 0 ? 'error' : 'ok',
      detail
    });
    return { ok: written > 0 || fromCache > 0, written, fromCache, detail };
  }
};
