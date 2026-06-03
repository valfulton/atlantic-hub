'use client';

/**
 * DistressWatchlistPanel  (#372, val 2026-06-03)
 *
 * The Revenue Distress Intelligence Engine surface. Top-N entities by
 * weighted distress score for THIS client. Operator clicks "Rescore" to
 * recompute over the lookback window; "Seed CBB defaults" applies the
 * advisor's 7 weights if no weights are configured yet.
 *
 * The framing this lives under: Atlantic Hub doesn't sell leads, it sells
 * predictive intelligence about who's about to need this client's service.
 * For CBB that means lawsuits + bankruptcies + UCC filings + suspensions.
 * For Marty (consumer loans) the weights tilt toward HMDA + Census ACS.
 * For Adriana (CLDA liens) the weights tilt toward CA SOS suspensions.
 */
import { useEffect, useState, useCallback } from 'react';

interface SignalHit {
  signalKind: string;
  entityKey: string;
  entityLabel: string | null;
  regionCode: string | null;
  source: string;
}

interface WatchlistRow {
  entityKey: string;
  entityLabel: string | null;
  regionCode: string | null;
  score: number;
  contributingSignals: SignalHit[];
  firstSeenAt: string;
  lastRecomputedAt: string;
  lastAction: 'contacted' | 'dismissed' | 'converted' | 'ignored' | null;
  lastActedAt: string | null;
}

const SIGNAL_LABEL: Record<string, string> = {
  new_llc: 'New LLC',
  suspended_entity: 'Suspended',
  dissolved_entity: 'Dissolved',
  leadership_change: 'Leadership change',
  high_denial_rate: 'High denial rate',
  high_refinance_volume: 'High refinance volume',
  complaint_velocity_high: 'CFPB complaint velocity',
  lender_under_fire: 'Lender under fire',
  lawsuit_filed: 'Lawsuit filed',
  bankruptcy_filed: 'Bankruptcy',
  ucc_filing: 'UCC filing',
  credit_risk_increase: 'Credit risk ↑',
  negative_review_trend: 'Negative review trend',
  address_change: 'Address change',
  rapid_growth: 'Rapid growth'
};

function scoreColor(score: number): string {
  if (score >= 100) return 'text-red-300';
  if (score >= 50) return 'text-amber-300';
  if (score >= 20) return 'text-yellow-200';
  return 'text-emerald-300';
}

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const d = Math.round((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (d < 1) return 'today';
  if (d === 1) return '1d ago';
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

export default function DistressWatchlistPanel({ clientId, clientName }: { clientId: number; clientName: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<WatchlistRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/av/clients/${clientId}/distress?limit=25`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j.ok) { setError(j.error || 'Could not load.'); return; }
      setRows(j.rows as WatchlistRow[]);
      setError(null);
    } catch {
      setError('Could not load.');
    }
  }, [clientId]);

  useEffect(() => {
    if (open && !rows) load();
  }, [open, rows, load]);

  async function rescore(seed: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/av/clients/${clientId}/distress/rescore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seedDefaults: seed, lookbackDays: 90 })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setError(j.error || 'Rescore failed.');
      } else {
        const summary = `${j.entitiesScored ?? 0} entities scored from ${j.recordsScanned ?? 0} records${j.seeded > 0 ? ` · seeded ${j.seeded} default weights` : ''}`;
        setLastSummary(summary);
        await load();
      }
    } catch {
      setError('Rescore failed.');
    } finally {
      setBusy(false);
    }
  }

  const empty = rows && rows.length === 0;

  return (
    <div className="rounded-2xl border border-border bg-surface overflow-hidden mb-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={
          'w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors ' +
          (open ? 'bg-red-400/[0.08] hover:bg-red-400/[0.12]' : 'bg-red-400/[0.04] hover:bg-red-400/[0.08]')
        }
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            aria-hidden
            className="shrink-0 w-7 h-7 rounded-md bg-red-400/15 border border-red-400/30 flex items-center justify-center text-red-300 text-sm"
          >
            ◉
          </span>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.14em] text-red-300">Distress watchlist</div>
            <div className="text-sm text-ink/95 mt-0.5">
              Top entities likely to need {clientName} this week — scored from public records
            </div>
          </div>
        </div>
        <span className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-red-300/80">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>
      {open && (
        <div className="px-4 py-4 border-t border-red-400/20">
          <p className="text-[11px] text-muted mb-3 leading-snug">
            Weighted signals from this client&apos;s public intelligence records (CA SOS suspensions, CourtListener
            filings, HMDA, CFPB, etc.). Each signal carries a per-client weight you can tune. Re-running is free —
            cached records do most of the work.
          </p>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <button
              type="button"
              onClick={() => rescore(false)}
              disabled={busy}
              className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-200 text-[12px] px-3 py-1.5 disabled:opacity-50"
            >
              {busy ? 'Scoring…' : '▶ Rescore now'}
            </button>
            <button
              type="button"
              onClick={() => rescore(true)}
              disabled={busy}
              className="rounded-lg border border-border bg-black/30 hover:bg-white/5 text-ink text-[12px] px-3 py-1.5 disabled:opacity-50"
              title="Apply the advisor's 7 default weights for collections / legal services clients. Idempotent — won't overwrite existing weights."
            >
              Seed CBB defaults + rescore
            </button>
            {lastSummary && <span className="text-[11px] text-muted">{lastSummary}</span>}
          </div>
          {error && (
            <div className="mb-3 text-[11px] text-danger rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2">{error}</div>
          )}
          {!rows && <div className="text-[11px] text-muted">Loading…</div>}
          {empty && (
            <div className="text-[12px] text-muted leading-snug">
              No watchlist entries yet. Click <strong className="text-ink">Rescore now</strong> to run the engine
              against this client&apos;s public intelligence records. If no Public Intelligence sources are configured
              yet, set one up in the Public intelligence panel above first.
            </div>
          )}
          {rows && rows.length > 0 && (
            <ol className="grid gap-1.5">
              {rows.map((row, i) => (
                <li
                  key={row.entityKey}
                  className="grid grid-cols-[36px_minmax(0,1fr)_auto] items-baseline gap-3 rounded-lg border border-border bg-black/20 px-3 py-2"
                >
                  <span className="text-[11px] text-muted tabular-nums">{i + 1}.</span>
                  <div className="min-w-0">
                    <div className="text-[12.5px] text-ink truncate">
                      {row.entityLabel ?? row.entityKey}
                    </div>
                    <div className="text-[11px] text-muted flex flex-wrap gap-1.5 mt-0.5">
                      {row.regionCode && (
                        <span className="rounded bg-bg/60 border border-border px-1 py-0.5">{row.regionCode}</span>
                      )}
                      {row.contributingSignals.slice(0, 4).map((s, j) => (
                        <span
                          key={j}
                          className="rounded bg-amber-400/10 border border-amber-400/25 text-amber-200 px-1 py-0.5"
                          title={s.source}
                        >
                          {SIGNAL_LABEL[s.signalKind] ?? s.signalKind}
                        </span>
                      ))}
                      {row.contributingSignals.length > 4 && (
                        <span className="text-muted/60">+{row.contributingSignals.length - 4} more</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-medium tabular-nums ${scoreColor(row.score)}`}>{row.score}</div>
                    <div className="text-[10px] text-muted">{relTime(row.lastRecomputedAt)}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
