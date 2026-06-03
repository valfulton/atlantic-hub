/**
 * lib/public_intel/adapters/datasf.ts  (#388, val 2026-06-03)
 *
 * San Francisco Open Data (Socrata) — one of the strongest open-data
 * portals in the US. This adapter is configurable across DataSF's distress-
 * relevant datasets via the `dataset` field:
 *
 *   - 'building_complaints' (default): SFDBI building inspection complaints.
 *       Each row = an address + complaint description + status. Properties
 *       with active or unresolved complaints are leading indicators of
 *       motivated sellers (real estate) AND operational stress (collections).
 *   - 'code_violations': Issued Notices of Violation from SFDBI. Smaller,
 *       more curated set than complaints — the actual NOV stage of the
 *       enforcement funnel.
 *   - '311_cases': 311 service requests. Firehose; useful for tract-level
 *       pattern detection but not entity-level scoring.
 *
 * Auth: no auth required for low volume. Set DATASF_APP_TOKEN env var to
 * raise rate limits.
 *
 * Cost: $0 — Socrata is free public API. Cached 7 days per record.
 *
 * Why "Same data, different buyer": a code violation is a motivated-seller
 * signal for a wholesaler and an operational-stress signal for a collections
 * agency targeting that property's owning LLC. One adapter, two cascades.
 */
import type { PublicIntelAdapter, RunContext, RunResult } from '../types';
import { storeRecord, findCachedRecord, noteRun } from '../store';

interface DataSfConfig {
  dataset?: DataSfDataset;
  /** Look-back window in days (default 30). */
  sinceDays?: number;
  /** Optional neighborhood filter (SF Analysis Neighborhood name). */
  neighborhood?: string;
  /** Optional zip filter (5-digit). */
  zip?: string;
  /** Cap on records pulled per run (default 100). */
  maxRecords?: number;
}

type DataSfDataset = 'building_complaints' | 'code_violations' | '311_cases';

interface DataSfDatasetSpec {
  /** Socrata dataset id (the 4x4 in the URL). */
  socrataId: string;
  label: string;
  /** Date field used for the since-X-days filter. */
  dateField: string;
  /** Free-form summary field for the record's summary_label. */
  summaryField: string;
  /** Address field. */
  addressField: string;
  /** Optional neighborhood field. */
  neighborhoodField?: string;
  /** Optional zip field. */
  zipField?: string;
  /** Entity key prefix — `datasf:<prefix>:<row_id>`. */
  entityPrefix: string;
}

const DATASETS: Record<DataSfDataset, DataSfDatasetSpec> = {
  building_complaints: {
    // SFDBI Complaints. If this id needs swapping per Socrata catalog changes,
    // config can override at the source level via env or stored config.
    socrataId: 'wnda-frmg',
    label: 'SFDBI building complaints',
    dateField: 'date_filed',
    summaryField: 'complaint_description',
    addressField: 'address',
    neighborhoodField: 'neighborhood',
    zipField: 'zipcode',
    entityPrefix: 'sfdbi-complaint'
  },
  code_violations: {
    // SFDBI Notices of Violation.
    socrataId: 'nbyn-xkze',
    label: 'SFDBI notices of violation',
    dateField: 'date_filed',
    summaryField: 'description',
    addressField: 'address',
    neighborhoodField: 'neighborhood',
    zipField: 'zipcode',
    entityPrefix: 'sfdbi-nov'
  },
  '311_cases': {
    socrataId: 'vw6y-z8j6',
    label: 'SF 311 service requests',
    dateField: 'requested_datetime',
    summaryField: 'service_subtype',
    addressField: 'address',
    neighborhoodField: 'neighborhoods_sffind_boundaries',
    zipField: 'supervisor_district',
    entityPrefix: 'sf311'
  }
};

const CACHE_DAYS = 7;
const SOCRATA_BASE = 'https://data.sfgov.org/resource';

function isCfg(v: unknown): v is DataSfConfig {
  if (v == null) return true;
  if (typeof v !== 'object') return false;
  return true;
}

function buildSoqlWhere(spec: DataSfDatasetSpec, cfg: DataSfConfig): string {
  const clauses: string[] = [];
  const sinceDays = Math.max(1, Math.min(365, cfg.sinceDays ?? 30));
  const sinceIso = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 19);
  clauses.push(`${spec.dateField} >= '${sinceIso}'`);
  if (cfg.neighborhood && spec.neighborhoodField) {
    const safe = cfg.neighborhood.replace(/'/g, "''");
    clauses.push(`upper(${spec.neighborhoodField}) like upper('%${safe}%')`);
  }
  if (cfg.zip && spec.zipField) {
    const safe = cfg.zip.replace(/[^0-9]/g, '');
    if (safe) clauses.push(`${spec.zipField}='${safe}'`);
  }
  return clauses.join(' AND ');
}

interface SocrataRow {
  [key: string]: unknown;
}

async function fetchDataSf(spec: DataSfDatasetSpec, where: string, limit: number): Promise<SocrataRow[] | null> {
  const params = new URLSearchParams();
  params.set('$where', where);
  params.set('$limit', String(limit));
  params.set('$order', `${spec.dateField} DESC`);
  const url = `${SOCRATA_BASE}/${spec.socrataId}.json?${params.toString()}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = process.env.DATASF_APP_TOKEN;
  if (token) headers['X-App-Token'] = token;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json) ? (json as SocrataRow[]) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

function pickString(r: SocrataRow, field: string): string | null {
  const v = r[field];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export const dataSfAdapter: PublicIntelAdapter = {
  kind: 'datasf',
  displayName: 'DataSF (San Francisco — building complaints + NOVs)',
  description:
    'San Francisco Open Data via Socrata API. Pulls building-inspection complaints + notices of violation + 311 cases. A code violation on a property is a motivated-seller signal for RE investors AND an operational-stress signal for collections agencies targeting that owner — same data, two cascades.',
  requiresKey: false,
  apiKeyEnv: 'DATASF_APP_TOKEN',
  costNote: '$0 · Socrata API · optional app token raises rate limit · cached 7 days',
  bestFor: ['Real estate investors (SF distress hunting)', 'CBB / collections (operational stress signals)', 'SF-based local services'],

  validateConfig(config) {
    if (config == null) return null;
    if (!isCfg(config)) return 'config must be an object';
    const c = config as DataSfConfig;
    if (c.dataset && !DATASETS[c.dataset]) {
      return `dataset must be one of: ${Object.keys(DATASETS).join(', ')}`;
    }
    if (c.sinceDays !== undefined && (typeof c.sinceDays !== 'number' || c.sinceDays < 1)) {
      return 'sinceDays must be a positive number';
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
    const cfg: DataSfConfig = (cfgRaw as DataSfConfig | null) ?? {};
    const datasetKey: DataSfDataset = cfg.dataset ?? 'building_complaints';
    const spec = DATASETS[datasetKey];
    const maxRecords = Math.max(1, Math.min(500, cfg.maxRecords ?? 100));

    const where = buildSoqlWhere(spec, cfg);
    const rows = await fetchDataSf(spec, where, maxRecords);
    if (!rows) {
      await noteRun({ sourceId: ctx.source.sourceId, status: 'error', detail: 'DataSF fetch failed (timeout or non-200)' });
      return { ok: false, written: 0, fromCache: 0, detail: 'DataSF fetch failed' };
    }

    let written = 0;
    let fromCache = 0;
    const expires = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000);

    for (const row of rows) {
      // Stable per-row id — try the row's own id, fall back to a synthetic hash.
      const rowId =
        pickString(row, 'complaint_number') ||
        pickString(row, 'nov_id') ||
        pickString(row, 'service_request_id') ||
        pickString(row, 'permit_number') ||
        pickString(row, ':id') ||
        // Last resort — synthesize from address + date so re-runs dedup.
        `${pickString(row, spec.addressField) ?? 'unknown'}-${pickString(row, spec.dateField) ?? '0'}`;
      const entityKey = `datasf:${spec.entityPrefix}:${rowId}`;
      const cached = await findCachedRecord(spec.entityPrefix, entityKey);
      if (cached) { fromCache++; continue; }
      const address = pickString(row, spec.addressField);
      const summary = pickString(row, spec.summaryField) ?? spec.label;
      const summaryLabel = address ? `${address} · ${summary}`.slice(0, 240) : summary.slice(0, 240);
      const zip = spec.zipField ? pickString(row, spec.zipField) : null;
      await storeRecord({
        sourceKind: 'datasf',
        entityKey,
        clientId: ctx.clientId ?? ctx.source.clientId,
        recordJson: { dataset: datasetKey, ...row },
        summaryLabel,
        regionCode: zip ? `CA-${zip}` : 'CA-SF',
        expiresAt: expires
      });
      written++;
    }

    const detail = `${written} new · ${fromCache} cached · dataset=${datasetKey}`;
    await noteRun({
      sourceId: ctx.source.sourceId,
      status: 'ok',
      detail
    });
    return { ok: true, written, fromCache, detail };
  }
};
