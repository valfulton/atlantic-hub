'use client';

/**
 * CascadePanel  (#374, val 2026-06-03)
 *
 * The "looks like magic" surface. Lists every cascade recipe registered
 * with its status (live or waiting for adapter), with a "Run cascades now"
 * button that sweeps recent records and fires every matching recipe.
 *
 * Recipes that depend on adapters not yet implemented (UCC, GBP, PACER docket
 * scraper) show as "Coming online when [adapter] ships" — the architecture is
 * here, the data plug-in is the remaining work.
 */
import { useEffect, useState, useCallback } from 'react';

interface RecipeRow {
  id: string;
  displayName: string;
  description: string;
  bestFor: string[];
  requires: string[];
  status: 'live' | 'pending_adapter';
}

interface SweepBreakdown {
  recordsScanned: number;
  recipesFired: number;
  recordsCreated: number;
  byRecipe: Record<string, { fired: number; created: number; detail: string[] }>;
}

export default function CascadePanel({ clientId, clientName }: { clientId: number; clientName: string }) {
  const [open, setOpen] = useState(false);
  const [recipes, setRecipes] = useState<RecipeRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSweep, setLastSweep] = useState<SweepBreakdown | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/av/clients/${clientId}/cascades`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j.ok) { setError(j.error || 'Could not load.'); return; }
      setRecipes(j.recipes as RecipeRow[]);
      setError(null);
    } catch { setError('Could not load.'); }
  }, [clientId]);

  useEffect(() => {
    if (open && !recipes) load();
  }, [open, recipes, load]);

  async function runSweep() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/av/clients/${clientId}/cascades/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lookbackDays: 7 })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { setError(j.error || 'Run failed.'); }
      else { setLastSweep(j as SweepBreakdown); }
    } catch { setError('Run failed.'); }
    finally { setBusy(false); }
  }

  const liveCount = recipes ? recipes.filter((r) => r.status === 'live').length : 0;
  const pendingCount = recipes ? recipes.filter((r) => r.status === 'pending_adapter').length : 0;

  return (
    <div className="rounded-2xl border border-border bg-surface overflow-hidden mb-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={
          'w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors ' +
          (open ? 'bg-violet-400/[0.08] hover:bg-violet-400/[0.12]' : 'bg-violet-400/[0.04] hover:bg-violet-400/[0.08]')
        }
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            aria-hidden
            className="shrink-0 w-7 h-7 rounded-md bg-violet-400/15 border border-violet-400/30 flex items-center justify-center text-violet-300 text-sm"
          >
            ⌁
          </span>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.14em] text-violet-300">Cascade pipeline</div>
            <div className="text-sm text-ink/95 mt-0.5">
              Chain reactions: one record in → multiple enriched entities out
            </div>
          </div>
        </div>
        <span className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-violet-300/80">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>
      {open && (
        <div className="px-4 py-4 border-t border-violet-400/20">
          <p className="text-[11px] text-muted mb-3 leading-snug">
            Cascade recipes fire automatically when a triggering record lands. Sweep runs every recipe over the
            last 7 days of records for {clientName}. After a sweep, click Rescore on the Distress watchlist to
            surface new entries.
          </p>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <button
              type="button"
              onClick={runSweep}
              disabled={busy}
              className="rounded-lg border border-violet-400/40 bg-violet-400/10 hover:bg-violet-400/20 text-violet-200 text-[12px] px-3 py-1.5 disabled:opacity-50"
            >
              {busy ? 'Sweeping…' : '▶ Run cascades now'}
            </button>
            {recipes && (
              <span className="text-[11px] text-ink/70">
                {liveCount} live · {pendingCount} pending adapter
              </span>
            )}
          </div>
          {error && (
            <div className="mb-3 text-[11px] text-danger rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2">{error}</div>
          )}
          {lastSweep && (
            <div className="mb-3 text-[11px] rounded-md border border-violet-400/30 bg-violet-400/10 px-3 py-2 text-ink/90">
              Swept {lastSweep.recordsScanned} records · fired {lastSweep.recipesFired} recipes · created {lastSweep.recordsCreated} cascade entities
            </div>
          )}
          {!recipes && <div className="text-[11px] text-muted">Loading recipes…</div>}
          {recipes && (
            <ul className="grid gap-3">
              {recipes.map((r) => {
                const sweepStats = lastSweep?.byRecipe?.[r.id];
                return (
                  <li
                    key={r.id}
                    className={`rounded-xl border ${r.status === 'live' ? 'border-border bg-bg/40' : 'border-border/40 bg-bg/20'} p-3.5`}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-ink font-medium">{r.displayName}</span>
                          {r.status === 'live' ? (
                            <span className="text-[10px] uppercase tracking-[0.12em] text-emerald-300 border border-emerald-400/30 rounded px-1.5 py-0.5">Live</span>
                          ) : (
                            <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--gold-bright)] border border-[color-mix(in_srgb,var(--gold-bright)_30%,transparent)] rounded px-1.5 py-0.5">
                              Pending: {r.requires.filter((req) => !['hmda', 'cfpb', 'census_acs', 'ca_sos', 'courtlistener'].includes(req)).join(' + ') || 'adapter'}
                            </span>
                          )}
                        </div>
                        <div className="text-[11.5px] text-muted leading-snug mt-1">{r.description}</div>
                        <div className="text-[11px] text-muted mt-1.5">
                          <span className="text-ink/70">Best for:</span> {r.bestFor.join(' · ')}
                        </div>
                        {sweepStats && (sweepStats.fired > 0 || sweepStats.detail.length > 0) && (
                          <div className="text-[11px] text-violet-200/85 mt-1.5">
                            Last sweep: fired {sweepStats.fired} × · created {sweepStats.created} entities
                            {sweepStats.detail.length > 0 && (
                              <ul className="mt-1 ml-3 list-disc text-ink/75">
                                {sweepStats.detail.slice(0, 3).map((d, i) => (
                                  <li key={i} className="leading-snug">{d}</li>
                                ))}
                                {sweepStats.detail.length > 3 && (
                                  <li className="text-muted">+{sweepStats.detail.length - 3} more</li>
                                )}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
