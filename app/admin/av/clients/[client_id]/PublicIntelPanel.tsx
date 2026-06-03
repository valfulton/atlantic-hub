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

// Adapter-specific config hint strings — placeholder + example. Kept here in
// the UI (vs. on the server adapter) so the form can be inline-helpful without
// shipping more code into the client bundle.
const CONFIG_HINT: Record<string, { placeholder: string; example: string }> = {
  hmda: {
    placeholder: '{ "states": ["FL", "CA"], "year": 2024 }',
    example: '{ "states": ["FL"], "year": 2024 }   or   { "countyFips": ["12099"], "year": 2024 }'
  },
  ca_sos: {
    placeholder: '{ "query": "Candelaria" }',
    example: '{ "query": "Candelaria" }   or   { "entityNumbers": ["C1234567"] }'
  },
  cfpb: {
    placeholder: '{ "states": ["FL"], "sinceDays": 90 }',
    example: '{ "states": ["FL", "CA"], "products": ["Mortgage"], "sinceDays": 90 }'
  },
  census_acs: {
    placeholder: '{ "countyFips": ["12099"], "year": 2022 }',
    example: '{ "countyFips": ["12099"] }   (Palm Beach FL — pair with HMDA same county)'
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
                      <label className="grid gap-1">
                        <span className="text-[10.5px] uppercase tracking-[0.12em] text-muted">
                          Config (JSON)
                        </span>
                        <textarea
                          value={drafts[a.kind] ?? ''}
                          onChange={(e) => setDrafts((p) => ({ ...p, [a.kind]: e.target.value }))}
                          placeholder={CONFIG_HINT[a.kind]?.placeholder ?? '{}'}
                          rows={3}
                          className="rounded-md border border-border bg-black/30 px-2.5 py-1.5 text-[12px] text-ink font-mono"
                          spellCheck={false}
                        />
                        {CONFIG_HINT[a.kind] && (
                          <span className="text-[10.5px] text-muted">
                            example: <code className="text-ink/80">{CONFIG_HINT[a.kind].example}</code>
                          </span>
                        )}
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
