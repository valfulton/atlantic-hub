'use client';

/**
 * PublicIntelPanel  (#369, val 2026-06-02)
 *
 * Operator surface for the Public Intelligence Layer. Lists every registered
 * adapter (HMDA + CA SOS live; CFPB/ACS/recorders/etc. shown as "coming soon"),
 * lets val toggle enable/disable per client, edit config (JSON for now —
 * each adapter exposes a hint string), and run the adapter immediately.
 *
 * Results from the last run land in the in-line records viewer below the
 * adapter card so val can SEE what came back without context-switching.
 *
 * Loads on demand (collapsed by default) — no LLM cost, no upstream fetch
 * until val opens it.
 */
import { useEffect, useState, useCallback } from 'react';

interface AdapterEntry {
  kind: string;
  displayName: string;
  description: string;
  requiresKey: boolean;
  costNote: string;
  bestFor: string[];
  available: boolean;
  source: {
    sourceId: number;
    enabled: boolean;
    config: Record<string, unknown> | null;
    lastRunAt: string | null;
    lastRunStatus: 'ok' | 'error' | 'skipped' | null;
    lastRunDetail: string | null;
  } | null;
}

interface IntelRecord {
  recordId: number;
  sourceKind: string;
  entityKey: string;
  summaryLabel: string | null;
  regionCode: string | null;
  record: unknown;
  fetchedAt: string;
}

// (#373) Per-adapter presets — click a chip and it drops formatted JSON
// straight into the config box. Each preset has a human label + a config
// object that gets JSON.stringify'd with 2-space indent. The placeholder is
// what shows in the empty textarea so val sees the shape before clicking.
interface ConfigPreset {
  label: string;
  config: Record<string, unknown>;
}
const CONFIG_PRESETS: Record<string, { placeholder: string; presets: ConfigPreset[] }> = {
  hmda: {
    placeholder: 'Pick a preset above to fill this in →',
    presets: [
      { label: 'Florida mortgage apps + denials — 2024', config: { states: ['FL'], year: 2024 } },
      { label: 'Florida + California mortgage apps + denials — 2024', config: { states: ['FL', 'CA'], year: 2024 } },
      { label: 'Palm Beach County mortgage apps + denials — 2024', config: { countyFips: ['12099'], year: 2024 } }
    ]
  },
  ca_sos: {
    // (val 2026-06-06) CA SOS bizfileOnline is a LOOKUP, not a sweep — the
    // API can't return "all suspended CA businesses." So presets are honest:
    // type a name in, get that entity's status out. Used mostly by cascades
    // (downstream of UCC/CourtListener triggers) to enrich a known name.
    placeholder: 'click a preset → then replace BUSINESS NAME with the real name',
    presets: [
      { label: 'Look up one business by name', config: { query: 'BUSINESS NAME HERE' } },
      { label: 'Look up by CA entity number (C1234567)', config: { entityNumbers: ['C1234567'] } },
      { label: 'Auto-run from cascades (recommended)', config: { mode: 'cascade_only' } }
    ]
  },
  cfpb: {
    placeholder: 'Pick a preset above to fill this in →',
    presets: [
      { label: 'Florida consumer complaints — all products, last 90d', config: { states: ['FL'], sinceDays: 90 } },
      { label: 'FL + CA mortgage complaints — last 90d', config: { states: ['FL', 'CA'], products: ['Mortgage'], sinceDays: 90 } },
      { label: 'CA debt-collection complaints — last 180d', config: { states: ['CA'], products: ['Debt collection'], sinceDays: 180 } }
    ]
  },
  census_acs: {
    placeholder: 'Pick a preset above to fill this in →',
    presets: [
      { label: 'Palm Beach County income + housing context (pairs with HMDA)', config: { countyFips: ['12099'] } },
      { label: 'LA County income + housing context', config: { countyFips: ['06037'] } },
      { label: 'Florida statewide demographics', config: { stateFips: ['12'] } },
      { label: 'California statewide demographics', config: { stateFips: ['06'] } }
    ]
  },
  courtlistener: {
    placeholder: 'Pick a preset above to fill this in →',
    presets: [
      { label: 'New CA federal court filings — last 14d (Collections starter)', config: { states: ['CA'], sinceDays: 14 } },
      { label: 'New CA + FL federal filings — last 14d', config: { states: ['CA', 'FL'], sinceDays: 14 } },
      { label: 'New CA federal bankruptcies — last 30d', config: { states: ['CA'], natureOfSuit: ['Bankruptcy'], sinceDays: 30 } },
      { label: 'New CA contract / debt suits — last 14d', config: { states: ['CA'], natureOfSuit: ['Contract: Other'], sinceDays: 14 } }
    ]
  },
  ucc_ca: {
    placeholder: 'click a preset →',
    presets: [
      // (val 2026-06-06) Relabeled — the old labels named the *search input*
      // ("Candelaria", "Acme") which meant nothing. The new labels describe
      // the OUTCOME so val knows what each preset finds.
      { label: 'Auto-run from cascades (recommended)', config: { mode: 'cascade_only' } },
      { label: 'Manual lookup — type a business name in JSON', config: { debtor: 'BUSINESS NAME HERE' } },
      { label: 'Include lapsed filings (5yr history)', config: { debtor: 'BUSINESS NAME HERE', includeLapsed: true } }
    ]
  },
  pacer_docket: {
    placeholder: 'Pick a preset above to fill this in →',
    presets: [
      { label: 'New CA bankruptcy dockets + creditors — last 30d', config: { states: ['CA'], sinceDays: 30 } },
      { label: 'New CA + FL bankruptcy dockets — last 30d', config: { states: ['CA', 'FL'], sinceDays: 30 } },
      { label: 'Pull specific dockets by ID', config: { docketIds: [123456] } }
    ]
  },
  gbp: {
    placeholder: 'Pick a preset above to fill this in →',
    presets: [
      { label: 'Track your own list of places (paste IDs)', config: { placeIds: [] } },
      { label: 'Auto-find places to track from a search', config: { seedQuery: 'collections agency Los Angeles' } }
    ]
  },
  datasf: {
    placeholder: 'Pick a preset above to fill this in →',
    presets: [
      { label: 'SF properties with new building complaints — last 30d', config: { dataset: 'building_complaints', sinceDays: 30, maxRecords: 100 } },
      { label: 'SF properties with new code violations — last 30d', config: { dataset: 'code_violations', sinceDays: 30, maxRecords: 100 } },
      { label: 'SF 311 service cases — last 14d', config: { dataset: '311_cases', sinceDays: 14, maxRecords: 100 } },
      { label: 'Mission-district building complaints — last 60d', config: { dataset: 'building_complaints', sinceDays: 60, neighborhood: 'Mission', maxRecords: 100 } }
    ]
  },
  // (#423) Maryland Land Records — statewide. Presets pick the highest-distress-
  // volume jurisdictions and the distress-specific document types. Each preset
  // also sets a sensible sinceDays so the first run has real catch-up depth.
  md_land_rec: {
    placeholder: 'Pick a preset above to fill this in →',
    presets: [
      {
        label: 'Top-4 MD counties — all distress filings, last 60d',
        config: {
          counties: ['Montgomery', 'Prince George\'s', 'Baltimore County', 'Baltimore City'],
          sinceDays: 60
        }
      },
      {
        label: 'Baltimore metro distress filings — last 30d',
        config: {
          counties: ['Baltimore City', 'Baltimore County'],
          sinceDays: 30
        }
      },
      {
        label: 'MoCo + PG (DC suburbs) distress filings — last 30d',
        config: {
          counties: ['Montgomery', 'Prince George\'s'],
          sinceDays: 30
        }
      },
      {
        label: 'Top-4 counties — foreclosure filings only, last 30d',
        config: {
          counties: ['Montgomery', 'Prince George\'s', 'Baltimore County', 'Baltimore City'],
          docTypes: ['Notice of Sale', 'Lis Pendens', 'Substitute Trustee', 'Trustee Deed'],
          sinceDays: 30
        }
      },
      {
        label: 'Statewide MD foreclosure filings — last 30d',
        config: {
          counties: [
            'Allegany', 'Anne Arundel', 'Baltimore City', 'Baltimore County', 'Calvert',
            'Caroline', 'Carroll', 'Cecil', 'Charles', 'Dorchester', 'Frederick', 'Garrett',
            'Harford', 'Howard', 'Kent', 'Montgomery', 'Prince George\'s', 'Queen Anne\'s',
            'Somerset', 'St. Mary\'s', 'Talbot', 'Washington', 'Wicomico', 'Worcester'
          ],
          docTypes: ['Notice of Sale', 'Lis Pendens', 'Substitute Trustee'],
          sinceDays: 30
        }
      },
      {
        label: 'Top-4 counties — tax-sale filings, last 90d',
        config: {
          counties: ['Montgomery', 'Prince George\'s', 'Baltimore County', 'Baltimore City'],
          docTypes: ['Tax Sale Certificate', 'Tax Sale Deed'],
          sinceDays: 90
        }
      },
      {
        label: 'Anne Arundel — all distress, last 60d',
        config: {
          counties: ['Anne Arundel'],
          sinceDays: 60
        }
      },
      {
        // Waterfront Anne Arundel — surfaces filings whose legal description
        // mentions known shoreline neighborhoods around Annapolis + the
        // Severn / South River corridors. Post-filter at the adapter level
        // once that flag is wired; for now the operator gets a labelled
        // search hint via `legalDescriptionContains`.
        label: 'Waterfront Anne Arundel — distress filings, last 60d',
        config: {
          counties: ['Anne Arundel'],
          sinceDays: 60,
          docTypes: ['Notice of Sale', 'Lis Pendens', 'Substitute Trustee', 'Trustee Deed'],
          legalDescriptionContains: [
            'Eastport', 'Murray Hill', 'Bay Ridge', 'Annapolis Roads',
            'Hillsmere', 'Wardour', 'Sherwood Forest', 'Severna Park',
            'Arnold', 'Cape St. Claire', 'Riva', 'Edgewater',
            'Mayo', 'Galesville', 'Shady Side', 'Deale'
          ]
        }
      }
    ]
  }
};

// (val 2026-06-06) Group adapters by what they DO for the operator. Three
// buckets:
//   1. prospect_source — adapters val triggers manually that emit business
//      names she can promote to leads. The top-of-funnel.
//   2. cascade_source — adapters that fire automatically when an upstream
//      trigger lands (e.g. UCC lookup after a CA SOS suspension). No reason
//      to run these by hand — they execute via Run Cascades.
//   3. coming_soon — adapter scaffolded but not yet usable.
//
// Any adapter not in the map falls into "Other / signal enrichment".
type AdapterCategory = 'prospect_source' | 'cascade_source' | 'enrichment' | 'coming_soon';
const ADAPTER_CATEGORY: Record<string, AdapterCategory> = {
  ca_sos: 'prospect_source',
  pacer_docket: 'prospect_source',
  courtlistener: 'prospect_source',
  gbp: 'prospect_source',
  datasf: 'prospect_source',
  md_land_rec: 'prospect_source',
  ucc_ca: 'cascade_source',
  hmda: 'enrichment',
  cfpb: 'enrichment',
  census_acs: 'enrichment'
};
const CATEGORY_META: Record<AdapterCategory, { title: string; subtitle: string }> = {
  prospect_source: {
    title: 'Find prospects',
    subtitle: 'Run these to surface business names you can promote to leads. Start here.'
  },
  cascade_source: {
    title: 'Auto-fires via cascade',
    subtitle: 'These run automatically when a trigger lands. You usually don\'t need to touch them.'
  },
  enrichment: {
    title: 'Scoring + context',
    subtitle: 'These add weight to existing prospects (HMDA, Census, CFPB complaint volume). Background fuel.'
  },
  coming_soon: {
    title: 'Coming soon',
    subtitle: 'Scaffolded but not live yet.'
  }
};
const CATEGORY_ORDER: AdapterCategory[] = ['prospect_source', 'cascade_source', 'enrichment', 'coming_soon'];

function categorize(adapter: AdapterEntry): AdapterCategory {
  if (!adapter.available) return 'coming_soon';
  return ADAPTER_CATEGORY[adapter.kind] ?? 'enrichment';
}

function relTime(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

// (#429) Smoke-test result row. Status colors match the lastRunStatus chip
// scheme used in the adapter cards just below.
interface SmokeResult {
  kind: string;
  displayName: string;
  status: 'ok' | 'error' | 'skipped' | 'timeout' | 'not_configured' | 'disabled' | 'not_available';
  written: number;
  fromCache: number;
  detail: string;
  elapsedMs: number;
}

interface SmokeReport {
  ranAt: string;
  totalElapsedMs: number;
  summary: Partial<Record<SmokeResult['status'], number>>;
  results: SmokeResult[];
}

const SMOKE_STATUS_COPY: Record<SmokeResult['status'], { label: string; cls: string }> = {
  ok:              { label: 'Worked',         cls: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10' },
  skipped:         { label: 'No new data',    cls: 'text-amber-200 border-amber-400/30 bg-amber-400/10' },
  error:           { label: 'Errored',        cls: 'text-danger border-red-400/30 bg-red-400/10' },
  timeout:         { label: 'Timed out',      cls: 'text-danger border-red-400/30 bg-red-400/10' },
  not_configured:  { label: 'Not configured', cls: 'text-muted border-border bg-bg/40' },
  disabled:        { label: 'Disabled',       cls: 'text-muted border-border bg-bg/40' },
  not_available:   { label: 'Not built yet',  cls: 'text-muted border-border bg-bg/30' }
};

// (val 2026-06-06) Vertical packs the operator can activate one-tap. Mirrors
// lib/public_intel/vertical_packs.ts. Kept in sync by hand for now since this
// is presentation only; the endpoint validates the packId server-side.
const STARTER_PACKS: { id: string; label: string }[] = [
  { id: 'collections',          label: 'Collections agencies + legal referrals' },
  { id: 'real_estate',          label: 'Real estate (distress + recovery)' },
  { id: 'b2b_sales',            label: 'B2B sales (payroll · merchant · ADP-style)' },
  { id: 'commercial_insurance', label: 'Commercial insurance brokers' },
  { id: 'commercial_lending',   label: 'Commercial lending (banks · equipment finance)' },
  { id: 'law_firm',             label: 'Law firm (collections · bankruptcy · employment)' },
  { id: 'recruiting',           label: 'Recruiting + executive search' },
  { id: 'marketing_agency',     label: 'Marketing agency (AV\'s own register)' },
  { id: 'luxury_hospitality',   label: 'Luxury hospitality (yacht · marina · estate events)' }
];

interface AdapterRunReport {
  kind: string;
  displayName: string;
  status: 'ran' | 'skipped_lookup' | 'skipped_unavailable' | 'errored';
  detail: string;
  written?: number;
  fromCache?: number;
}

interface ActivatePackResult {
  ok: boolean;
  packId: string;
  packName?: string;
  weightsSeeded?: number;
  adapterReports?: AdapterRunReport[];
  rescored?: { entitiesScored: number; recordsScanned: number } | null;
  elapsedMs?: number;
  error?: string;
}

export default function PublicIntelPanel({ clientId, clientName }: { clientId: number; clientName: string }) {
  const [open, setOpen] = useState(false);
  const [adapters, setAdapters] = useState<AdapterEntry[] | null>(null);
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [recordsByKind, setRecordsByKind] = useState<Record<string, IntelRecord[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [smokeBusy, setSmokeBusy] = useState(false);
  const [smokeReport, setSmokeReport] = useState<SmokeReport | null>(null);
  // (val 2026-06-06) Starter-pack one-tap activation state.
  const [packPick, setPackPick] = useState<string>('collections');
  const [packBusy, setPackBusy] = useState(false);
  const [packResult, setPackResult] = useState<ActivatePackResult | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/admin/av/clients/${clientId}/public-intel/sources`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setError(j.error || 'Could not load.');
        return;
      }
      setAdapters(j.adapters as AdapterEntry[]);
      // Seed draft configs from each source row.
      const next: Record<string, string> = {};
      for (const a of j.adapters as AdapterEntry[]) {
        next[a.kind] = a.source?.config ? JSON.stringify(a.source.config, null, 2) : '';
      }
      setDrafts(next);
    } catch {
      setError('Could not load.');
    }
  }, [clientId]);

  useEffect(() => {
    if (open && !adapters) load();
  }, [open, adapters, load]);

  async function saveConfig(kind: string, enabled: boolean) {
    setBusyKind(kind);
    setError(null);
    try {
      const draft = (drafts[kind] ?? '').trim();
      let config: Record<string, unknown> | null = null;
      if (draft.length > 0) {
        try {
          config = JSON.parse(draft);
        } catch {
          setError(`Invalid JSON for ${kind}`);
          setBusyKind(null);
          return;
        }
      }
      const r = await fetch(`/api/admin/av/clients/${clientId}/public-intel/sources`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceKind: kind, enabled, config })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setError(j.reason || j.error || 'Save failed.');
        setBusyKind(null);
        return;
      }
      await load();
    } catch {
      setError('Save failed.');
    } finally {
      setBusyKind(null);
    }
  }

  async function runNow(kind: string) {
    setBusyKind(kind);
    setError(null);
    try {
      const r = await fetch(`/api/admin/av/clients/${clientId}/public-intel/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceKind: kind })
      });
      const j = await r.json();
      if (!r.ok || j.ok === false) {
        setError(j.reason || j.detail || j.error || 'Run failed.');
      }
      // Always reload adapter + records — partial successes happen.
      await load();
      await loadRecords(kind);
    } catch {
      setError('Run failed.');
    } finally {
      setBusyKind(null);
    }
  }

  // (#429) Smoke-test every adapter at once. Hits the new endpoint
  // /public-intel/smoke-test which runs each enabled adapter sequentially
  // with a 10s per-adapter cap and reports per-adapter status.
  async function smokeTestAll() {
    setSmokeBusy(true);
    setSmokeReport(null);
    setError(null);
    try {
      const r = await fetch(`/api/admin/av/clients/${clientId}/public-intel/smoke-test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' }
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setError(j.error || 'Smoke test failed.');
        return;
      }
      setSmokeReport({
        ranAt: j.ranAt,
        totalElapsedMs: j.totalElapsedMs,
        summary: j.summary,
        results: j.results
      });
      // Refresh adapter cards too so their last-run timestamps update.
      await load();
    } catch {
      setError('Smoke test failed.');
    } finally {
      setSmokeBusy(false);
    }
  }

  // (val 2026-06-06) One-tap "activate the starter pack for this client's
  // vertical." Seeds signal weights, enables + auto-configs + runs each
  // recommended adapter, then triggers a distress rescore. Replaces the
  // "scroll past 10 adapter cards, type JSON into each" first-run loop.
  async function activatePack() {
    if (!packPick || packBusy) return;
    setPackBusy(true);
    setPackResult(null);
    setError(null);
    try {
      const r = await fetch(
        `/api/admin/av/clients/${clientId}/intelligence/activate-pack`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ packId: packPick })
        }
      );
      const j: ActivatePackResult = await r.json();
      if (!r.ok || !j.ok) {
        setError(j.error || 'Pack activation failed.');
        setPackResult(j);
        return;
      }
      setPackResult(j);
      // Refresh the panel so newly-enabled adapters reflect their new state.
      await load();
    } catch {
      setError('Pack activation failed.');
    } finally {
      setPackBusy(false);
    }
  }

  async function loadRecords(kind: string) {
    try {
      const r = await fetch(
        `/api/admin/av/clients/${clientId}/public-intel/records?kind=${encodeURIComponent(kind)}&limit=10`,
        { cache: 'no-store' }
      );
      const j = await r.json();
      if (r.ok && j.ok) {
        setRecordsByKind((prev) => ({ ...prev, [kind]: j.records as IntelRecord[] }));
      }
    } catch { /* non-fatal */ }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface overflow-hidden mb-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={
          'w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors ' +
          (open ? 'bg-brand/[0.08] hover:bg-brand/[0.12]' : 'bg-brand/[0.04] hover:bg-brand/[0.08]')
        }
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            aria-hidden
            className="shrink-0 w-7 h-7 rounded-md bg-brand/15 border border-brand/30 flex items-center justify-center text-brand text-sm"
          >
            ⊕
          </span>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.14em] text-brand">Public intelligence</div>
            <div className="text-sm text-ink/95 mt-0.5">
              Free public data adapters: HMDA · CA SOS · CFPB · Census · recorders
            </div>
          </div>
        </div>
        <span className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-brand/80">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>
      {open && (
        <div className="px-4 py-4 border-t border-brand/20">
          <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
            <p className="text-[11px] text-muted leading-snug max-w-[60ch]">
              Pull free public records for {clientName}. Each adapter caches results (no double-charge re-runs).
              Results land in the records viewer below.
            </p>
            {/* (#429) One-click "are these actually working?" sweep.
                Runs every enabled adapter for this client, reports per-adapter status. */}
            <button
              type="button"
              onClick={smokeTestAll}
              disabled={smokeBusy}
              className={
                'shrink-0 rounded-md border text-[11.5px] font-medium px-3 py-1.5 transition-colors ' +
                (smokeBusy
                  ? 'border-border bg-bg/40 text-muted cursor-wait'
                  : 'border-brand/40 bg-brand/[0.10] hover:bg-brand/[0.18] text-brand')
              }
              title="Run every configured adapter for this client and report per-adapter status"
            >
              {smokeBusy ? 'Testing…' : '⚙ Test all adapters'}
            </button>
          </div>

          {/* (val 2026-06-06) 🚀 Starter pack — the confident default. One tap
              picks the right adapters for this client's vertical, runs them,
              rescores. Replaces "scroll past 10 cards and type JSON." */}
          <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--gold-bright)_30%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_6%,transparent)] p-3.5">
            <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
              <div className="min-w-0">
                <div className="text-[10.5px] uppercase tracking-[0.14em] text-[var(--gold-bright)]">Starter pack</div>
                <div className="text-[11.5px] text-ink/80 leading-snug mt-0.5">
                  One tap: enable the right adapters for this vertical, run them, rescore the watchlist.
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-stretch gap-2">
              <select
                value={packPick}
                onChange={(e) => setPackPick(e.target.value)}
                disabled={packBusy}
                className="flex-1 min-w-[180px] rounded-md border border-border bg-bg/40 text-ink text-[12px] px-2.5 py-1.5 focus:outline-none focus:border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)]"
                aria-label="Vertical pack to activate"
              >
                {STARTER_PACKS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={activatePack}
                disabled={packBusy}
                className={
                  'shrink-0 rounded-md border text-[12px] font-medium px-3 py-1.5 transition-colors ' +
                  (packBusy
                    ? 'border-border bg-bg/40 text-muted cursor-wait'
                    : 'border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_18%,transparent)] hover:bg-[color-mix(in_srgb,var(--gold-bright)_28%,transparent)] text-[var(--gold-bright)]')
                }
                title="Apply the pack's signal weights, enable + run its adapters, then rescore the distress watchlist"
              >
                {packBusy ? 'Activating…' : '🚀 Activate'}
              </button>
            </div>
            {packResult && (
              <div className="mt-3 rounded-md border border-border/60 bg-bg/40 p-2.5">
                <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--gold-bright)] mb-1.5">
                  {packResult.ok ? 'Activated' : 'Activation failed'} · {packResult.packName ?? packResult.packId}
                  {typeof packResult.elapsedMs === 'number' && (
                    <span className="text-muted normal-case tracking-normal"> · {(packResult.elapsedMs/1000).toFixed(1)}s</span>
                  )}
                </div>
                {packResult.ok ? (
                  <ul className="text-[11.5px] text-ink/85 space-y-0.5">
                    <li>· Signal weights seeded: <span className="text-emerald-300">{packResult.weightsSeeded ?? 0}</span></li>
                    {(packResult.adapterReports ?? []).map((r) => (
                      <li key={r.kind} className="flex items-baseline justify-between gap-2">
                        <span className="truncate">
                          <span className={
                            r.status === 'ran' ? 'text-emerald-300'
                              : r.status === 'errored' ? 'text-danger'
                              : 'text-muted'
                          }>
                            {r.status === 'ran' ? '✓' : r.status === 'errored' ? '✗' : '○'}
                          </span>{' '}
                          {r.displayName}
                          {r.status === 'ran' && typeof r.written === 'number' && (
                            <span className="text-muted"> · {r.written} written{r.fromCache ? `, ${r.fromCache} from cache` : ''}</span>
                          )}
                          {r.status === 'skipped_lookup' && (
                            <span className="text-muted"> · fires via cascade</span>
                          )}
                          {r.status === 'skipped_unavailable' && (
                            <span className="text-muted"> · coming soon</span>
                          )}
                          {r.status === 'errored' && (
                            <span className="text-danger"> · {r.detail}</span>
                          )}
                        </span>
                      </li>
                    ))}
                    {packResult.rescored && (
                      <li>· Rescored watchlist: <span className="text-emerald-300">{packResult.rescored.entitiesScored}</span> entities from {packResult.rescored.recordsScanned} records</li>
                    )}
                  </ul>
                ) : (
                  <div className="text-[11.5px] text-danger">{packResult.error || 'Unknown error.'}</div>
                )}
              </div>
            )}
          </div>
          {smokeReport && (
            <div className="mb-4 rounded-xl border border-brand/30 bg-brand/[0.06] p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                <div className="text-[11px] uppercase tracking-[0.14em] text-brand">
                  Smoke test · {new Date(smokeReport.ranAt).toLocaleTimeString()} · {(smokeReport.totalElapsedMs/1000).toFixed(1)}s
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['ok','skipped','error','timeout','not_configured','disabled','not_available'] as SmokeResult['status'][])
                    .filter((s) => (smokeReport.summary[s] ?? 0) > 0)
                    .map((s) => (
                      <span
                        key={s}
                        className={`text-[10.5px] uppercase tracking-[0.1em] rounded px-1.5 py-0.5 border ${SMOKE_STATUS_COPY[s].cls}`}
                      >
                        {smokeReport.summary[s]} {SMOKE_STATUS_COPY[s].label.toLowerCase()}
                      </span>
                    ))}
                </div>
              </div>
              <ul className="grid gap-1.5">
                {smokeReport.results.map((r) => (
                  <li
                    key={r.kind}
                    className="flex items-start justify-between gap-3 text-[11.5px] rounded-md border border-border bg-bg/30 px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-ink/95 font-medium">{r.displayName}</span>
                        <span className={`text-[10px] uppercase tracking-[0.1em] rounded px-1.5 py-0.5 border ${SMOKE_STATUS_COPY[r.status].cls}`}>
                          {SMOKE_STATUS_COPY[r.status].label}
                        </span>
                        {(r.written > 0 || r.fromCache > 0) && (
                          <span className="text-[10.5px] text-muted">
                            {r.written} new · {r.fromCache} cached
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted mt-0.5 break-words">{r.detail}</div>
                    </div>
                    {r.elapsedMs > 0 && (
                      <span className="shrink-0 text-[10.5px] text-muted tabular-nums">
                        {r.elapsedMs}ms
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && (
            <div className="mb-3 text-[11px] text-danger rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2">
              {error}
            </div>
          )}
          {!adapters ? (
            <div className="text-[11px] text-muted">Loading adapters…</div>
          ) : (
            (() => {
              // (val 2026-06-06) Group adapters by category so the panel reads
              // like a checklist instead of 10 random cards. Each section gets
              // a heading + one-line explainer so val knows what to DO in each.
              const buckets = new Map<AdapterCategory, AdapterEntry[]>();
              for (const a of adapters) {
                const cat = categorize(a);
                const cur = buckets.get(cat) ?? [];
                cur.push(a);
                buckets.set(cat, cur);
              }
              return (
                <div className="grid gap-5">
                  {CATEGORY_ORDER.filter((cat) => (buckets.get(cat) ?? []).length > 0).map((cat) => {
                    const meta = CATEGORY_META[cat];
                    const list = buckets.get(cat) ?? [];
                    return (
                      <section key={cat} className="grid gap-2">
                        <header className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
                          <div className="min-w-0">
                            <div className="text-[10.5px] uppercase tracking-[0.14em] text-[var(--gold-bright)]">{meta.title}</div>
                            <div className="text-[11.5px] text-muted leading-snug mt-0.5">{meta.subtitle}</div>
                          </div>
                          <div className="text-[10.5px] text-muted/70 tabular-nums shrink-0">{list.length}</div>
                        </header>
                        <ul className="grid gap-3">
                          {list.map((a) => (
                <li
                  key={a.kind}
                  className={`rounded-xl border ${a.available ? 'border-border bg-bg/40' : 'border-border/40 bg-bg/20'} p-3.5`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-ink font-medium">{a.displayName}</span>
                        {!a.available && (
                          <span className="text-[10px] uppercase tracking-[0.12em] text-muted/80 border border-border rounded px-1.5 py-0.5">
                            Coming soon
                          </span>
                        )}
                        {a.source?.enabled && a.available && (
                          <span className="text-[10px] uppercase tracking-[0.12em] text-emerald-300 border border-emerald-400/30 rounded px-1.5 py-0.5">
                            Enabled
                          </span>
                        )}
                      </div>
                      <div className="text-[11.5px] text-muted leading-snug mt-1">{a.description}</div>
                      <div className="text-[11px] text-muted mt-1.5">
                        <span className="text-ink/70">Best for:</span> {a.bestFor.join(' · ')}
                        <span className="mx-1.5 text-muted/40">·</span>
                        <span className="text-ink/70">{a.costNote}</span>
                      </div>
                      {a.source && (
                        <div className="text-[11px] text-muted mt-1.5">
                          Last run:{' '}
                          <span className={
                            a.source.lastRunStatus === 'ok' ? 'text-emerald-300'
                              : a.source.lastRunStatus === 'error' ? 'text-danger'
                              : 'text-muted'
                          }>
                            {relTime(a.source.lastRunAt)}
                            {a.source.lastRunDetail ? ` — ${a.source.lastRunDetail}` : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  {a.available && (
                    <div className="mt-3 grid gap-2">
                      <label className="grid gap-1.5">
                        <span className="text-[10.5px] uppercase tracking-[0.12em] text-muted">
                          Config (JSON)
                        </span>
                        {/* (#373) Click-to-fill preset chips. One click drops the
                            formatted JSON straight into the textarea below — no
                            typing required for the common cases. */}
                        {CONFIG_PRESETS[a.kind] && (
                          <div className="flex flex-wrap items-center gap-1.5 -mt-0.5">
                            <span className="text-[10.5px] text-ink/70 uppercase tracking-[0.1em]">
                              Quick fill:
                            </span>
                            {CONFIG_PRESETS[a.kind].presets.map((p) => (
                              <button
                                key={p.label}
                                type="button"
                                onClick={() =>
                                  setDrafts((prev) => ({
                                    ...prev,
                                    [a.kind]: JSON.stringify(p.config, null, 2)
                                  }))
                                }
                                className="rounded-md border border-brand/40 bg-brand/[0.08] hover:bg-brand/[0.16] text-brand text-[11px] font-medium px-2 py-1 transition-colors"
                                title="Click to populate the config box with this preset"
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                        )}
                        <textarea
                          value={drafts[a.kind] ?? ''}
                          onChange={(e) => setDrafts((p) => ({ ...p, [a.kind]: e.target.value }))}
                          placeholder={CONFIG_PRESETS[a.kind]?.placeholder ?? '{}'}
                          rows={5}
                          className="rounded-md border border-border bg-black/40 px-3 py-2 text-[13px] text-ink font-mono leading-relaxed placeholder:text-ink/35"
                          spellCheck={false}
                        />
                        <span className="text-[10.5px] text-ink/55">
                          Tip: edit the JSON directly after a preset to tweak it. Save + enable persists; Run now fires the adapter.
                        </span>
                      </label>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => saveConfig(a.kind, true)}
                          disabled={busyKind === a.kind}
                          className="rounded-lg border border-border bg-brand text-black font-medium text-[12px] px-3 py-1.5 disabled:opacity-50"
                        >
                          {busyKind === a.kind ? 'Working…' : 'Save + enable'}
                        </button>
                        {a.source && (
                          <button
                            type="button"
                            onClick={() => saveConfig(a.kind, !a.source!.enabled)}
                            disabled={busyKind === a.kind}
                            className="rounded-lg border border-border bg-black/30 hover:bg-white/5 text-ink text-[12px] px-3 py-1.5 disabled:opacity-50"
                          >
                            {a.source.enabled ? 'Disable' : 'Re-enable'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => runNow(a.kind)}
                          disabled={busyKind === a.kind}
                          className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-200 text-[12px] px-3 py-1.5 disabled:opacity-50"
                        >
                          {busyKind === a.kind ? 'Running…' : '▶ Run now'}
                        </button>
                        <button
                          type="button"
                          onClick={() => loadRecords(a.kind)}
                          className="text-[11px] text-muted hover:text-ink underline"
                        >
                          Show records
                        </button>
                      </div>
                      {recordsByKind[a.kind] && recordsByKind[a.kind].length > 0 && (
                        <div className="mt-2 rounded-md border border-border bg-black/20 p-2.5">
                          <div className="text-[10.5px] uppercase tracking-[0.12em] text-muted mb-1.5">
                            Latest {recordsByKind[a.kind].length} records
                          </div>
                          <ul className="grid gap-1">
                            {recordsByKind[a.kind].map((r) => (
                              <li key={r.recordId} className="text-[11.5px] text-ink/90 leading-snug">
                                <span className="text-muted">{relTime(r.fetchedAt)}</span>
                                {r.regionCode && <span className="text-muted"> · {r.regionCode}</span>}
                                {r.summaryLabel ? <> — {r.summaryLabel}</> : <> — {r.entityKey}</>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              );
            })()
          )}
        </div>
      )}
    </div>
  );
}
