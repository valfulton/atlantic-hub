/**
 * lib/public_intel/activate_pack.ts  (val 2026-06-06)
 *
 * The 🚀 one-tap starter-pack activator. Wraps:
 *   1. applyVerticalPackToClient — seeds signal weights from the pack
 *   2. upsertSource — for each recommendedAdapter in the pack, provisions a
 *      public_intel_sources row (enabled=true) with a sane default config
 *      derived from the adapter kind. Sweep adapters get geo-anchored configs;
 *      lookup-only adapters (ca_sos, ucc_ca) get provisioned but skipped.
 *   3. run — fires each runnable adapter (best-effort, errors don't block siblings)
 *   4. rescoreClient — refreshes the distress watchlist with the new records
 *
 * Returns a structured report the UI can render as "5/7 sources ran, 142
 * records pulled, 18 entities scored." No throws — adapter errors are
 * captured per-step.
 *
 * Cap: each adapter runs serially within a single ~60s function. Long-tail
 * sweeps (PACER, MD recorder full state) live on the HostGator worker and
 * are kicked off async — we trigger them but don't block waiting.
 */
import type { PublicIntelKind } from './types';
import { getAdapter } from './registry';
import { upsertSource, listSourcesForClient } from './store';
import {
  applyVerticalPackToClient,
  type VerticalPackId
} from './vertical_packs';
import { rescoreClient } from './distress_engine';

/**
 * Per-adapter "first-run" config defaults. Same-state CA-centric for the
 * shipped vertical packs (collections, real_estate, commercial_lending) since
 * Adriana + CBB + Marty are all California today. When a non-CA client lands,
 * the operator-side preset chips override these manually.
 *
 * "skip" means the adapter is a lookup-only adapter (needs a name input) —
 * we still provision the source row so it appears enabled in the panel, but
 * we don't auto-run it. The cascade pipeline will trigger it when an upstream
 * source emits a name to look up.
 */
const FIRST_RUN_CONFIG: Record<string, Record<string, unknown> | 'skip'> = {
  ca_sos:        'skip',     // lookup, not sweep — needs a name
  ca_sos_v2:     'skip',     // not yet available
  ucc_ca:        'skip',     // cascade-driven
  pacer_docket:  { states: ['CA'], sinceDays: 30 },
  courtlistener: { states: ['CA'], sinceDays: 14 },
  cfpb:          { states: ['CA'], sinceDays: 90 },
  hmda:          { states: ['CA'], year: 2024 },
  census_acs:    { stateFips: ['06'] },
  gbp:           { seedQuery: 'collections agency California' },
  datasf:        { dataset: 'code_violations', sinceDays: 30, maxRecords: 100 },
  md_land_rec:   { counties: ['Anne Arundel'], sinceDays: 60 },
  ca_recorder:   'skip'      // coming soon — provision but no run
};

export interface AdapterRunReport {
  kind: PublicIntelKind;
  displayName: string;
  status: 'ran' | 'skipped_lookup' | 'skipped_unavailable' | 'errored';
  detail: string;
  written?: number;
  fromCache?: number;
}

export interface ActivatePackReport {
  ok: boolean;
  packId: VerticalPackId;
  packName: string;
  weightsSeeded: number;
  adapterReports: AdapterRunReport[];
  rescored: {
    entitiesScored: number;
    recordsScanned: number;
  } | null;
  elapsedMs: number;
}

export async function activatePackForClient(
  clientId: number,
  packId: VerticalPackId
): Promise<ActivatePackReport> {
  const start = Date.now();
  const adapterReports: AdapterRunReport[] = [];

  // 1. Apply pack — seeds signal weights idempotently.
  const apply = await applyVerticalPackToClient(clientId, packId);
  if (!apply.ok) {
    return {
      ok: false,
      packId,
      packName: packId,
      weightsSeeded: 0,
      adapterReports: [],
      rescored: null,
      elapsedMs: Date.now() - start
    };
  }

  // 2. Provision + run each recommended adapter.
  for (const kind of apply.recommendedAdapters) {
    const entry = getAdapter(kind);
    if (!entry) {
      adapterReports.push({
        kind,
        displayName: String(kind),
        status: 'skipped_unavailable',
        detail: 'adapter not registered'
      });
      continue;
    }
    if (!entry.available) {
      // Still provision (so the panel shows it as a future enable), but don't run.
      await upsertSource({ clientId, sourceKind: kind, enabled: false, config: null });
      adapterReports.push({
        kind,
        displayName: entry.adapter.displayName,
        status: 'skipped_unavailable',
        detail: 'coming soon — provisioned disabled'
      });
      continue;
    }

    const firstRunConfig = FIRST_RUN_CONFIG[kind] ?? null;

    // Always upsert the source row so the panel reflects the pack assignment.
    await upsertSource({
      clientId,
      sourceKind: kind,
      enabled: true,
      config: firstRunConfig === 'skip' ? null : (firstRunConfig as Record<string, unknown> | null)
    });

    if (firstRunConfig === 'skip') {
      adapterReports.push({
        kind,
        displayName: entry.adapter.displayName,
        status: 'skipped_lookup',
        detail: 'lookup-only adapter — fires via cascade'
      });
      continue;
    }

    // Reload source row to get the persisted sourceId.
    const sources = await listSourcesForClient(clientId);
    const source = sources.find((s) => s.sourceKind === kind);
    if (!source) {
      adapterReports.push({
        kind,
        displayName: entry.adapter.displayName,
        status: 'errored',
        detail: 'source row missing post-upsert'
      });
      continue;
    }

    try {
      const result = await entry.adapter.run({ source, clientId });
      adapterReports.push({
        kind,
        displayName: entry.adapter.displayName,
        status: 'ran',
        detail: result.detail ?? '',
        written: result.written,
        fromCache: result.fromCache
      });
    } catch (err) {
      adapterReports.push({
        kind,
        displayName: entry.adapter.displayName,
        status: 'errored',
        detail: (err as Error).message.slice(0, 200)
      });
    }
  }

  // 3. Trigger rescore so the new records land in the distress watchlist.
  let rescored: ActivatePackReport['rescored'] = null;
  try {
    const r = await rescoreClient(clientId, 90);
    rescored = {
      entitiesScored: r.entitiesScored ?? 0,
      recordsScanned: r.recordsScanned ?? 0
    };
  } catch {
    // Non-fatal — UI shows "rescore later" when rescored is null.
  }

  return {
    ok: true,
    packId,
    packName: apply.nextSteps[0]?.replace(/^Vertical:\s*/, '') ?? String(packId),
    weightsSeeded: apply.weightsSeeded,
    adapterReports,
    rescored,
    elapsedMs: Date.now() - start
  };
}
