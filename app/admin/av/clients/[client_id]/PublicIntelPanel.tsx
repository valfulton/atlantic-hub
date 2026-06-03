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
    placeholder: 'click a preset →',
    presets: [
      { label: 'FL state · 2024', config: { states: ['FL'], year: 2024 } },
      { label: 'FL + CA · 2024', config: { states: ['FL', 'CA'], year: 2024 } },
      { label: 'Palm Beach county only', config: { countyFips: ['12099'], year: 2024 } }
    ]
  },
  ca_sos: {
    placeholder: 'click a preset →',
    presets: [
      { label: 'Search "Candelaria"', config: { query: 'Candelaria' } },
      { label: 'Search "Acme"', config: { query: 'Acme' } },
      { label: 'Active entities only', config: { query: 'Candelaria', includeInactive: false } },
      { label: 'Specific entity number', config: { entityNumbers: ['C1234567'] } }
    ]
  },
  cfpb: {
    placeholder: 'click a preset →',
    presets: [
      { label: 'FL · all products · 90d', config: { states: ['FL'], sinceDays: 90 } },
      { label: 'FL + CA · Mortgage · 90d', config: { states: ['FL', 'CA'], products: ['Mortgage'], sinceDays: 90 } },
      { label: 'CA · Debt collection · 180d', config: { states: ['CA'], products: ['Debt collection'], sinceDays: 180 } }
    ]
  },
  census_acs: {
    placeholder: 'click a preset →',
    presets: [
      { label: 'Palm Beach FL (pairs with HMDA)', config: { countyFips: ['12099'] } },
      { label: 'LA County CA', config: { countyFips: ['06037'] } },
      { label: 'FL state-level', config: { stateFips: ['12'] } },
      { label: 'CA state-level', config: { stateFips: ['06'] } }
    ]
  },
  courtlistener: {
    placeholder: 'click a preset →',
    presets: [
      { label: 'CA · last 14d (CBB starter)', config: { states: ['CA'], sinceDays: 14 } },
      { label: 'CA + FL · last 14d', config: { states: ['CA', 'FL'], sinceDays: 14 } },
      { label: 'CA · Bankruptcy only · 30d', config: { states: ['CA'], natureOfSuit: ['Bankruptcy'], sinceDays: 30 } },
      { label: 'CA · Contract / debt · 14d', config: { states: ['CA'], natureOfSuit: ['Contract: Other'], sinceDays: 14 } }
    ]
  },
  ucc_ca: {
    placeholder: 'click a preset →',
    presets: [
      { label: 'Search "Candelaria"', config: { debtor: 'Candelaria' } },
      { label: 'Search "Acme"', config: { debtor: 'Acme' } },
      { label: 'Include lapsed filings', config: { debtor: 'Candelaria', includeLapsed: true } }
    ]
  },
  pacer_docket: {
    placeholder: 'click a preset →',
    presets: [
      { label: 'CA bankruptcies · last 30d', config: { states: ['CA'], sinceDays: 30 } },
      { label: 'CA + FL bankruptcies · 30d', config: { states: ['CA', 'FL'], sinceDays: 30 } },
      { label: 'Specific docket IDs', config: { docketIds: [123456] } }
    ]
  },
  gbp: {
    placeholder: 'click a preset →',
    presets: [
      { label: 'Empty (paste your place IDs)', config: { placeIds: [] } },
      { label: 'Seed from a search', config: { seedQuery: 'collections agency Los Angeles' } }
    ]
  },
  datasf: {
    placeholder: 'click a preset →',
    presets: [
      { label: 'SF building complaints · last 30d', config: { dataset: 'building_complaints', sinceDays: 30, maxRecords: 100 } },
      { label: 'SF Notices of Violation · last 30d', config: { dataset: 'code_violations', sinceDays: 30, maxRecords: 100 } },
      { label: 'SF 311 cases · last 14d', config: { dataset: '311_cases', sinceDays: 14, maxRecords: 100 } },
      { label: 'Mission district · last 60d', config: { dataset: 'building_complaints', sinceDays: 60, neighborhood: 'Mission', maxRecords: 100 } }
    ]
  }
};

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

export default function PublicIntelPanel({ clientId, clientName }: { clientId: number; clientName: string }) {
  const [open, setOpen] = useState(false);
  const [adapters, setAdapters] = useState<AdapterEntry[] | null>(null);
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [recordsByKind, setRecordsByKind] = useState<Record<string, IntelRecord[]>>({});
  const [error, setError] = useState<string | null>(null);

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
          <p className="text-[11px] text-muted mb-3 leading-snug">
            Pull free public records for {clientName}. Each adapter caches results (no double-charge re-runs).
            Results land in the records viewer below.
          </p>
          {error && (
            <div className="mb-3 text-[11px] text-danger rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2">
              {error}
            </div>
          )}
          {!adapters ? (
            <div className="text-[11px] text-muted">Loading adapters…</div>
          ) : (
            <ul className="grid gap-3">
              {adapters.map((a) => (
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
          )}
        </div>
      )}
    </div>
  );
}
