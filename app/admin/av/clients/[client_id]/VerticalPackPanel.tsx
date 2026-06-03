'use client';

/**
 * VerticalPackPanel  (#376, val 2026-06-03)
 *
 * The "what business is this client in?" panel. Lists the 8 vertical packs;
 * one click seeds the client's distress signal weights from the pack, names
 * the recommended adapters to enable, names the cascade recipes that should
 * fire, and surfaces the pitch + pricing thesis val uses to sell.
 *
 * This is the horizontal-platform repositioning made concrete: same engine,
 * different pack per vertical. Onboarding a new vertical-fit client = pick
 * a pack, apply, enable the recommended adapters, run cascades, rescore.
 */
import { useEffect, useState, useCallback } from 'react';

interface PackRow {
  id: string;
  displayName: string;
  shortPositioning: string;
  bestForRoles: string[];
  pitchTemplate: string;
  pricingThesis: string;
  suggestedPriceUsd: { low: number; high: number };
  recommendedAdapters: string[];
  cascadeRecipeIds: string[];
  signalCount: number;
}

interface ApplyResult {
  ok: boolean;
  packId: string;
  weightsSeeded: number;
  recommendedAdapters: string[];
  cascadeRecipesActivated: string[];
  nextSteps: string[];
}

export default function VerticalPackPanel({ clientId, clientName }: { clientId: number; clientName: string }) {
  const [open, setOpen] = useState(false);
  const [packs, setPacks] = useState<PackRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/av/clients/${clientId}/vertical-pack`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j.ok) { setError(j.error || 'Could not load.'); return; }
      setPacks(j.packs as PackRow[]);
      setError(null);
    } catch { setError('Could not load.'); }
  }, [clientId]);

  useEffect(() => {
    if (open && !packs) load();
  }, [open, packs, load]);

  async function applyPack(packId: string) {
    if (!confirm(`Apply the "${packId}" vertical pack to ${clientName}?\n\nThis seeds the distress signal weights for this vertical and tells you which adapters to enable. Idempotent — your manual weight overrides stay.`)) return;
    setBusy(packId);
    setError(null);
    try {
      const r = await fetch(`/api/admin/av/clients/${clientId}/vertical-pack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packId })
      });
      const j = (await r.json()) as ApplyResult;
      if (!r.ok || !j.ok) {
        setError(`Apply failed: ${j.packId}`);
      } else {
        setLastResult(j);
      }
    } catch { setError('Apply failed.'); }
    finally { setBusy(null); }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface overflow-hidden mb-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={
          'w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors ' +
          (open ? 'bg-amber-400/[0.08] hover:bg-amber-400/[0.12]' : 'bg-amber-400/[0.04] hover:bg-amber-400/[0.08]')
        }
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            aria-hidden
            className="shrink-0 w-7 h-7 rounded-md bg-amber-400/15 border border-amber-400/30 flex items-center justify-center text-amber-300 text-sm"
          >
            ☷
          </span>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.14em] text-amber-300">Vertical pack</div>
            <div className="text-sm text-ink/95 mt-0.5">
              What business is {clientName} in? Pick a pack to seed signal weights + activate recipes.
            </div>
          </div>
        </div>
        <span className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-amber-300/80">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>
      {open && (
        <div className="px-4 py-4 border-t border-amber-400/20">
          <p className="text-[11px] text-muted mb-3 leading-snug">
            Same engine, different tuning per vertical. Applying a pack seeds the distress signal weights from
            the pack&apos;s template, names the adapters to enable first, and tells you which cascade recipes
            should fire for this customer. Idempotent — re-apply doesn&apos;t overwrite manual tuning.
          </p>
          {error && (
            <div className="mb-3 text-[11px] text-danger rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2">{error}</div>
          )}
          {lastResult && (
            <div className="mb-3 text-[11px] rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-ink/90">
              ✓ Applied <strong className="text-ink">{lastResult.packId}</strong> · seeded {lastResult.weightsSeeded} weights · {lastResult.cascadeRecipesActivated.length} recipes flagged · enable: {lastResult.recommendedAdapters.join(', ')}
            </div>
          )}
          {!packs && <div className="text-[11px] text-muted">Loading packs…</div>}
          {packs && (
            <ul className="grid gap-3">
              {packs.map((p) => (
                <li key={p.id} className="rounded-xl border border-border bg-bg/40 p-3.5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-ink font-medium">{p.displayName}</span>
                        <span className="text-[10px] uppercase tracking-[0.12em] text-amber-200 border border-amber-400/30 rounded px-1.5 py-0.5">
                          ${p.suggestedPriceUsd.low}–${p.suggestedPriceUsd.high}/mo
                        </span>
                      </div>
                      <div className="text-[11.5px] text-ink/85 leading-snug mt-1 italic">
                        &ldquo;{p.shortPositioning}&rdquo;
                      </div>
                      <div className="text-[11px] text-muted mt-1.5">
                        <span className="text-ink/70">Best for:</span> {p.bestForRoles.slice(0, 3).join(' · ')}
                        {p.bestForRoles.length > 3 && <span className="text-muted/60"> +{p.bestForRoles.length - 3} more</span>}
                      </div>
                      <div className="text-[11px] text-muted mt-1">
                        <span className="text-ink/70">Seeds:</span> {p.signalCount} signals · {p.cascadeRecipeIds.length} cascades · {p.recommendedAdapters.length} adapters
                      </div>
                      <details className="mt-2">
                        <summary className="text-[11px] text-muted cursor-pointer hover:text-ink">Pitch + pricing thesis</summary>
                        <div className="mt-2 text-[11.5px] text-ink/85 leading-snug border-l-2 border-amber-400/30 pl-2">
                          <div className="mb-1"><span className="text-ink/70 text-[10px] uppercase tracking-wider">Pitch:</span> {p.pitchTemplate}</div>
                          <div><span className="text-ink/70 text-[10px] uppercase tracking-wider">Pricing:</span> {p.pricingThesis}</div>
                        </div>
                      </details>
                    </div>
                    <button
                      type="button"
                      onClick={() => applyPack(p.id)}
                      disabled={busy === p.id}
                      className="shrink-0 rounded-lg border border-border bg-brand text-black font-medium text-[12px] px-3 py-1.5 disabled:opacity-50"
                    >
                      {busy === p.id ? 'Applying…' : 'Apply pack'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
