/**
 * lib/public_intel/adapters/ucc_ca.ts  (#379, val 2026-06-03)
 *
 * California UCC financing statements. Search by debtor name; each filing
 * returns the secured party (the vendor or lender exposed to that debtor).
 *
 * This is the adapter the cascade engine has been waiting for. When CA SOS
 * suspends an entity, the `suspended_entity_vendor_exposure` cascade recipe
 * fires UCC search on the suspended entity (as debtor). Every secured party
 * on the returned filings becomes a "vendor_exposed" watchlist entry for
 * the operator's client — a fresh prospect with a real pain point.
 *
 * One suspension → 5-15 fresh prospects automatically. The magical CBB move.
 *
 * Data source: CA Secretary of State UCC search portal at
 *   https://uccconnect.sos.ca.gov/
 * The public search endpoint is fronted by Apex / Salesforce. We POST a
 * documented form payload and receive JSON. No auth required.
 *
 * Gotchas:
 *   - The endpoint occasionally returns HTML instead of JSON when overloaded.
 *     Retry with exponential backoff (2 retries max).
 *   - Filings can span multiple debtor names per UCC-1. We dedupe by
 *     filing number, not by debtor.
 *   - "Filing date" is reported as MM/DD/YYYY. Normalize to ISO.
 *
 * Cache: 7 days per debtor query. UCC filings don't change after recording;
 * only new filings appear. A 7-day re-pull keeps the freshness without
 * hammering the portal.
 */
import type { PublicIntelAdapter, RunContext, RunResult } from '../types';
import { storeRecord, findCachedRecord, noteRun } from '../store';

interface UccCaConfig {
  /** Debtor name(s) to search. One search per debtor; results paginated up to 50. */
  debtors?: string[];
  /** Convenience single-debtor field — coalesces into `debtors`. */
  debtor?: string;
  /** Include lapsed filings (older than 5y past expiry). Default: false. */
  includeLapsed?: boolean;
}

interface UccFiling {
  filingNumber: string;
  filingDate: string | null;   // ISO YYYY-MM-DD when parseable
  filingType: string | null;   // UCC-1, UCC-3 amendment, etc.
  debtorName: string;
  debtorAddress: string | null;
  securedPartyName: string;
  securedPartyAddress: string | null;
  collateralDescription: string | null;
  isLapsed: boolean;
}

const CACHE_DAYS = 7;
const SEARCH_URL = 'https://uccconnect.sos.ca.gov/api/Records/UccSearch';

function isCfg(c: unknown): c is UccCaConfig {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (o.debtor !== undefined && typeof o.debtor !== 'string') return false;
  if (o.debtors !== undefined && !(Array.isArray(o.debtors) && o.debtors.every((s) => typeof s === 'string'))) return false;
  return true;
}

function normalizeDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

interface UccSearchResponse {
  rows?: Array<{
    FILING_NUM?: string;
    FILING_DATE?: string;
    FILING_TYPE?: string;
    DEBTOR_NAME?: string;
    DEBTOR_ADDRESS?: string;
    SECURED_PARTY_NAME?: string;
    SECURED_PARTY_ADDRESS?: string;
    COLLATERAL?: string;
    IS_LAPSED?: boolean;
  }>;
}

async function fetchByDebtor(debtor: string, includeLapsed: boolean): Promise<UccFiling[]> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 25000);
  // Two retries on HTML-instead-of-JSON drift.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(SEARCH_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'AtlanticHub/1.0 (research; PR@api.atlanticandvine.com)'
        },
        body: JSON.stringify({
          SEARCH_TYPE: 'DEBTOR',
          DEBTOR_NAME: debtor.toUpperCase(),
          INCLUDE_LAPSED: includeLapsed ? 'Y' : 'N',
          PAGE_SIZE: 50
        })
      });
      if (!res.ok) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        return [];
      }
      const text = await res.text();
      // Drift detection — the portal sometimes returns HTML on overload.
      if (!text.trim().startsWith('{') && !text.trim().startsWith('[')) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        return [];
      }
      const j = JSON.parse(text) as UccSearchResponse;
      const rows = j.rows ?? [];
      return rows.map((r) => ({
        filingNumber: r.FILING_NUM ?? '',
        filingDate: normalizeDate(r.FILING_DATE),
        filingType: r.FILING_TYPE ?? null,
        debtorName: r.DEBTOR_NAME ?? debtor,
        debtorAddress: r.DEBTOR_ADDRESS ?? null,
        securedPartyName: r.SECURED_PARTY_NAME ?? '',
        securedPartyAddress: r.SECURED_PARTY_ADDRESS ?? null,
        collateralDescription: r.COLLATERAL ?? null,
        isLapsed: !!r.IS_LAPSED
      }));
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return [];
    }
  }
  clearTimeout(tid);
  return [];
}

export const uccCaAdapter: PublicIntelAdapter = {
  kind: 'ucc_ca',
  displayName: 'CA UCC financing statements',
  description:
    'UCC-1 / UCC-3 filings by debtor — each filing names the secured party (the vendor/lender exposed). Lights up the "Suspended entity → Vendor exposure" cascade: one CA SOS suspension produces a watchlist entry for every secured party on the debtor\'s UCC filings.',
  requiresKey: false,
  costNote: 'Free · CA SOS UCC search portal · soft rate limit (1 req/sec recommended)',
  bestFor: ['CBB (collections — vendors exposed to suspended debtors)', 'Equipment finance', 'B2B credit'],

  validateConfig(config) {
    if (config == null) return null;
    if (!isCfg(config)) {
      return 'config must be { debtor?: string, debtors?: string[], includeLapsed?: boolean }';
    }
    const c: UccCaConfig = config;
    const hasDebtor = typeof c.debtor === 'string' && c.debtor.trim().length > 0;
    const hasDebtors = Array.isArray(c.debtors) && c.debtors.length > 0;
    if (!hasDebtor && !hasDebtors) return 'set debtor (string) or debtors (string[])';
    return null;
  },

  async run(ctx: RunContext): Promise<RunResult> {
    const cfgRaw = ctx.source.config;
    const valError = this.validateConfig(cfgRaw);
    if (valError) {
      await noteRun({ sourceId: ctx.source.sourceId, status: 'error', detail: `bad config: ${valError}` });
      return { ok: false, written: 0, fromCache: 0, detail: `bad config: ${valError}` };
    }
    const cfg: UccCaConfig = (cfgRaw as UccCaConfig | null) ?? {};
    const debtors: string[] = [];
    if (cfg.debtor) debtors.push(cfg.debtor);
    if (cfg.debtors) debtors.push(...cfg.debtors);
    const includeLapsed = cfg.includeLapsed === true;

    let written = 0;
    let fromCache = 0;
    const errors: string[] = [];

    for (const debtor of debtors) {
      const cacheKey = `ucc_ca:search:${debtor.toLowerCase().slice(0, 200)}`;
      const cached = await findCachedRecord<{ filings: UccFiling[] }>('ucc_ca', cacheKey);
      if (cached) {
        fromCache++;
        continue;
      }
      const filings = await fetchByDebtor(debtor, includeLapsed);
      if (filings.length === 0) {
        errors.push(debtor);
        continue;
      }
      const expires = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000);

      // Aggregate record per search.
      await storeRecord<{ debtor: string; filings: UccFiling[] }>({
        sourceKind: 'ucc_ca',
        entityKey: cacheKey,
        clientId: ctx.clientId ?? ctx.source.clientId,
        recordJson: { debtor, filings },
        summaryLabel: `UCC · "${debtor}" · ${filings.length} filings · ${new Set(filings.map((f) => f.securedPartyName)).size} secured parties`,
        regionCode: 'CA',
        expiresAt: expires
      });
      written++;

      // Per-filing rows so the distress engine + cascade can classify each
      // secured party individually. This is what the suspended_entity_vendor_exposure
      // cascade consumes.
      for (const f of filings.slice(0, 100)) {
        if (!f.filingNumber || !f.securedPartyName) continue;
        await storeRecord<UccFiling & { entity: string }>({
          sourceKind: 'ucc_ca',
          entityKey: `ucc_ca:filing:${f.filingNumber}`,
          clientId: ctx.clientId ?? ctx.source.clientId,
          recordJson: { ...f, entity: f.securedPartyName },
          summaryLabel: `${f.filingNumber} · debtor: ${f.debtorName.slice(0, 60)} · secured: ${f.securedPartyName.slice(0, 80)}`,
          regionCode: 'CA',
          expiresAt: expires
        });
      }
    }

    const detail = `${written} searches fetched, ${fromCache} from cache, ${errors.length} empty`;
    await noteRun({
      sourceId: ctx.source.sourceId,
      status: errors.length > 0 && written === 0 ? 'error' : 'ok',
      detail
    });
    return { ok: written > 0 || fromCache > 0, written, fromCache, detail };
  }
};
