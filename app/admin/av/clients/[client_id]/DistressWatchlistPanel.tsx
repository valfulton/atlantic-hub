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
  if (score >= 50) return 'text-[#EBCB6B]';
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

// (#382) Modal data when val clicks "Draft outreach" on a watchlist row.
interface DraftModalState {
  entityKey: string;
  entityLabel: string | null;
  status: 'loading' | 'ready' | 'error';
  subject?: string;
  body?: string;
  attributionHumanLine?: string | null;
  costMicrocents?: number;
  errorMessage?: string;
}

// (#385) Two-mode panel: 'operator' (val) hits /api/admin/av/clients/[id]/* paths
// and exposes the Seed-CBB-defaults button; 'client' (Adriana) hits /api/client/*
// paths and hides operator-only controls. Both expose Draft + Promote-to-lead.
export type DistressPanelMode = 'operator' | 'client';

interface DistressPanelProps {
  clientId: number;
  clientName: string;
  mode?: DistressPanelMode;
  /**
   * (#389) Server-rendered initial rows. When provided, the panel opens
   * pre-populated and skips the initial fetch. Used by the operator's
   * preview-as-client mirror so val can SEE the client's watchlist data
   * even though her operator-session cookie can't hit /api/client/*.
   */
  initialRows?: WatchlistRow[];
  /** (#389) Open the panel on mount when initialRows is provided. */
  startOpen?: boolean;
}

export default function DistressWatchlistPanel({ clientId, clientName, mode = 'operator', initialRows, startOpen }: DistressPanelProps) {
  const [open, setOpen] = useState(!!startOpen);
  const [rows, setRows] = useState<WatchlistRow[] | null>(initialRows ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<string | null>(null);
  const [draftModal, setDraftModal] = useState<DraftModalState | null>(null);
  const [copied, setCopied] = useState<'subject' | 'body' | null>(null);
  const [promoteState, setPromoteState] = useState<Record<string, 'idle' | 'busy' | 'done' | 'error'>>({});
  // (#390) Bulk selection state + bulk promote outcomes.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);

  // (#385) API path base derived from mode. Operator surface = scoped under
  // /admin/av/clients/[id]; client surface = unscoped /client/* (server reads
  // activeBrandFor() to scope to Adriana's current brand).
  const apiBase = mode === 'operator'
    ? `/api/admin/av/clients/${clientId}/distress`
    : `/api/client/distress`;
  const leadDetailPath = (auditId: string) => mode === 'operator'
    ? `/admin/av/leads/${auditId}`
    : `/client/leads/${auditId}`;

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}?limit=25`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j.ok) { setError(j.error || 'Could not load.'); return; }
      setRows(j.rows as WatchlistRow[]);
      setError(null);
    } catch {
      setError('Could not load.');
    }
  }, [apiBase]);

  useEffect(() => {
    // (#389) Skip the auto-fetch when initialRows seeded the panel — those
    // were server-rendered on the operator side and we don't want to clobber
    // them with a client-API call that will 401 in the preview context.
    if (open && !rows && !initialRows) load();
  }, [open, rows, load, initialRows]);

  async function rescore(seed: boolean) {
    // Client mode doesn't expose rescore (they read the operator's scored watchlist).
    if (mode === 'client') return;
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

  // (#382) Kick off a one-click outreach draft for a watchlist entity.
  async function draftFor(row: WatchlistRow) {
    setDraftModal({
      entityKey: row.entityKey,
      entityLabel: row.entityLabel,
      status: 'loading'
    });
    try {
      const r = await fetch(`${apiBase}/draft-outreach`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityKey: row.entityKey,
          entityLabel: row.entityLabel,
          score: row.score,
          signalKinds: row.contributingSignals.map((s) => s.signalKind),
          regionCode: row.regionCode
        })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setDraftModal({
          entityKey: row.entityKey,
          entityLabel: row.entityLabel,
          status: 'error',
          errorMessage: j.error || 'Draft failed.'
        });
        return;
      }
      setDraftModal({
        entityKey: row.entityKey,
        entityLabel: row.entityLabel,
        status: 'ready',
        subject: j.draft.subject,
        body: j.draft.body,
        attributionHumanLine: j.draft.attribution?.humanLine ?? null,
        costMicrocents: j.draft.costMicrocents
      });
    } catch {
      setDraftModal({
        entityKey: row.entityKey,
        entityLabel: row.entityLabel,
        status: 'error',
        errorMessage: 'Draft failed.'
      });
    }
  }

  // (#387) Promote a watchlist entity straight into the leads pipeline.
  async function promoteFor(row: WatchlistRow) {
    setPromoteState((s) => ({ ...s, [row.entityKey]: 'busy' }));
    try {
      const r = await fetch(`${apiBase}/promote-to-lead`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityKey: row.entityKey,
          entityLabel: row.entityLabel,
          score: row.score,
          signalKinds: row.contributingSignals.map((s) => s.signalKind),
          regionCode: row.regionCode
        })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setPromoteState((s) => ({ ...s, [row.entityKey]: 'error' }));
        return;
      }
      setPromoteState((s) => ({ ...s, [row.entityKey]: 'done' }));
      // Open the new lead in a new tab so the watchlist context isn't lost.
      if (j.auditId) {
        window.open(leadDetailPath(j.auditId), '_blank', 'noopener');
      }
    } catch {
      setPromoteState((s) => ({ ...s, [row.entityKey]: 'error' }));
    }
  }

  // (#390) Bulk-promote: take all currently selected rows → leads pipeline.
  async function promoteSelected() {
    const keys = Array.from(selected);
    if (keys.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkSummary(null);
    try {
      const r = await fetch(`${apiBase}/promote-bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityKeys: keys })
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setBulkSummary(j.error || 'Bulk promote failed.');
        setBulkBusy(false);
        return;
      }
      // Mark all promoted rows as "done" so individual buttons reflect state.
      const nextState: Record<string, 'idle' | 'busy' | 'done' | 'error'> = { ...promoteState };
      for (const res of j.results as Array<{ entityKey: string; created?: boolean; error?: string }>) {
        nextState[res.entityKey] = res.error ? 'error' : 'done';
      }
      setPromoteState(nextState);
      setSelected(new Set());
      setBulkSummary(`${j.created} added · ${j.alreadyExisted} already in pipeline${j.errored > 0 ? ` · ${j.errored} errored` : ''}`);
    } catch {
      setBulkSummary('Bulk promote failed.');
    } finally {
      setBulkBusy(false);
    }
  }

  function toggleRow(entityKey: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(entityKey)) next.delete(entityKey);
      else next.add(entityKey);
      return next;
    });
  }

  function toggleAll() {
    if (!rows) return;
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.entityKey)));
  }

  async function copyText(kind: 'subject' | 'body', text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1400);
    } catch { /* clipboard unavailable */ }
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
            Weighted signals from this client&apos;s public-records sources (CA SOS suspensions, CourtListener
            filings, HMDA, CFPB, and others). Each signal carries a per-client weight you can tune. Re-running is
            free — cached records carry most of the work.
          </p>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            {/* (#385) Operator-only controls: rescore + seed-defaults.
                Client view reads the latest scored watchlist as-is. */}
            {mode === 'operator' && (
              <>
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
              </>
            )}
            {mode === 'client' && (
              <button
                type="button"
                onClick={load}
                className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-200 text-[12px] px-3 py-1.5"
              >
                ↻ Refresh
              </button>
            )}
            {lastSummary && <span className="text-[11px] text-muted">{lastSummary}</span>}
          </div>
          {error && (
            <div className="mb-3 text-[11px] text-danger rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2">{error}</div>
          )}
          {!rows && <div className="text-[11px] text-muted">Loading…</div>}
          {empty && (
            <div className="text-[12px] text-muted leading-snug">
              No entries yet. Click <strong className="text-ink">Rescore now</strong> to score the public records
              on file for this client. If no Public Intelligence sources are configured yet, set one up in the
              Public intelligence panel above first.
            </div>
          )}
          {rows && rows.length > 0 && (
            <>
              {/* (#390) Bulk action bar — appears whenever rows are selected.
                  Mobile-stacks naturally via flex-wrap. */}
              <div className="mb-2 flex items-center justify-between gap-2 flex-wrap rounded-md border border-sky-400/30 bg-sky-400/[0.04] px-3 py-2">
                <label className="flex items-center gap-2 text-[11px] text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.size > 0 && selected.size === rows.length}
                    ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < rows.length; }}
                    onChange={toggleAll}
                    className="accent-sky-400"
                  />
                  <span>
                    {selected.size === 0
                      ? `Select rows to bulk-add`
                      : `${selected.size} of ${rows.length} selected`}
                  </span>
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {bulkSummary && <span className="text-[11px] text-muted">{bulkSummary}</span>}
                  <button
                    type="button"
                    onClick={promoteSelected}
                    disabled={bulkBusy || selected.size === 0}
                    className="rounded-md border border-sky-400/40 bg-sky-400/10 hover:bg-sky-400/20 text-sky-200 text-[11.5px] px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {bulkBusy ? `Adding ${selected.size}…` : `✚ Add ${selected.size || ''} to pipeline`.trim()}
                  </button>
                </div>
              </div>
              <ol className="grid gap-1.5">
                {rows.map((row, i) => (
                  <li
                    key={row.entityKey}
                    /* (#390) Mobile-first: stack everything on small screens
                        (rank+checkbox row, then content, then score+actions
                        rows). sm:grid restores the desktop columns. */
                    className="rounded-lg border border-border bg-black/20 px-3 py-2 grid gap-2 sm:gap-3 sm:grid-cols-[28px_28px_minmax(0,1fr)_auto_auto] sm:items-baseline"
                  >
                    {/* Rank + checkbox — share a row on mobile, separate cols on desktop. */}
                    <div className="flex items-center gap-2 sm:contents">
                      <input
                        type="checkbox"
                        checked={selected.has(row.entityKey)}
                        onChange={() => toggleRow(row.entityKey)}
                        className="accent-sky-400 sm:mt-1"
                        aria-label={`Select ${row.entityLabel ?? row.entityKey}`}
                      />
                      <span className="text-[11px] text-muted tabular-nums">{i + 1}.</span>
                      {/* Score on mobile only — moves up so it's visible without scrolling right. */}
                      <span className={`sm:hidden ml-auto text-sm font-medium tabular-nums ${scoreColor(row.score)}`}>{row.score}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[12.5px] text-ink break-words sm:truncate">
                        {row.entityLabel ?? row.entityKey}
                      </div>
                      <div className="text-[11px] text-muted flex flex-wrap gap-1.5 mt-0.5">
                        {row.regionCode && (
                          <span className="rounded bg-bg/60 border border-border px-1 py-0.5">{row.regionCode}</span>
                        )}
                        {row.contributingSignals.slice(0, 4).map((s, j) => (
                          <span
                            key={j}
                            className="rounded bg-[#EBCB6B]/10 border border-[#EBCB6B]/25 text-[#EBCB6B]/95 px-1 py-0.5"
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
                    {/* Score column — desktop only; mobile shows it in the rank row. */}
                    <div className="hidden sm:block text-right shrink-0">
                      <div className={`text-sm font-medium tabular-nums ${scoreColor(row.score)}`}>{row.score}</div>
                      <div className="text-[10px] text-muted">{relTime(row.lastRecomputedAt)}</div>
                    </div>
                    {/* Action buttons — wrap on mobile, inline on desktop. */}
                    <div className="flex items-center gap-1.5 flex-wrap sm:shrink-0">
                      <button
                        type="button"
                        onClick={() => draftFor(row)}
                        className="rounded-md border border-emerald-400/40 bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-200 text-[11px] px-2 py-1"
                        title="Draft a cold-outreach opener for this entity using the cascade attribution chain"
                      >
                        ✎ Draft
                      </button>
                      <button
                        type="button"
                        onClick={() => promoteFor(row)}
                        disabled={promoteState[row.entityKey] === 'busy' || promoteState[row.entityKey] === 'done'}
                        className={
                          'rounded-md border text-[11px] px-2 py-1 ' +
                          (promoteState[row.entityKey] === 'done'
                            ? 'border-emerald-400/60 bg-emerald-400/20 text-emerald-100'
                            : promoteState[row.entityKey] === 'error'
                            ? 'border-red-400/40 bg-red-400/10 text-red-200'
                            : 'border-sky-400/40 bg-sky-400/10 hover:bg-sky-400/20 text-sky-200')
                        }
                        title={
                          promoteState[row.entityKey] === 'done'
                            ? 'Added to your pipeline · opens lead detail in a new tab'
                            : 'Add this entity to the leads pipeline so it shows up alongside the rest of your prospects'
                        }
                      >
                        {promoteState[row.entityKey] === 'busy'
                          ? '…'
                          : promoteState[row.entityKey] === 'done'
                          ? '✓ Added'
                          : promoteState[row.entityKey] === 'error'
                          ? '! Retry'
                          : '✚ Add'}
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}

      {/* (#382) Draft modal — the institutional-memory-to-sales-artifact moment.
          (#390) Mobile-safe: full-height scrolling on small viewports, max-w-2xl on desktop. */}
      {draftModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto"
          onClick={() => setDraftModal(null)}
        >
          <div
            className="w-full max-w-2xl my-4 rounded-2xl border border-emerald-400/30 bg-surface shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-emerald-400/[0.04]">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-300">Drafted outreach</div>
                <div className="text-sm text-ink/95 truncate">
                  to {draftModal.entityLabel ?? draftModal.entityKey}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDraftModal(null)}
                className="text-muted hover:text-ink text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="px-4 py-4 overflow-y-auto">
              {draftModal.status === 'loading' && (
                <div className="text-[12px] text-muted py-6 text-center">
                  Drafting from the cascade attribution + the client offer… (≈3s)
                </div>
              )}
              {draftModal.status === 'error' && (
                <div className="text-[12px] text-danger rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2">
                  {draftModal.errorMessage}
                </div>
              )}
              {draftModal.status === 'ready' && (
                <>
                  {draftModal.attributionHumanLine && (
                    <div className="mb-3 text-[11px] rounded-md border border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-200 px-3 py-2">
                      <span className="uppercase tracking-[0.1em] mr-1.5 text-emerald-300/80">Signal chain ·</span>
                      {draftModal.attributionHumanLine}
                    </div>
                  )}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase tracking-[0.14em] text-muted">Subject</span>
                      <button
                        type="button"
                        onClick={() => copyText('subject', draftModal.subject ?? '')}
                        className="text-[11px] text-emerald-300 hover:text-emerald-200"
                      >
                        {copied === 'subject' ? '✓ copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="text-sm text-ink rounded-md border border-border bg-bg/40 px-3 py-2">
                      {draftModal.subject}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase tracking-[0.14em] text-muted">Body</span>
                      <button
                        type="button"
                        onClick={() => copyText('body', draftModal.body ?? '')}
                        className="text-[11px] text-emerald-300 hover:text-emerald-200"
                      >
                        {copied === 'body' ? '✓ copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="text-[13px] text-ink/90 rounded-md border border-border bg-bg/40 px-3 py-2 whitespace-pre-wrap leading-relaxed">
                      {draftModal.body}
                    </div>
                  </div>
                  <div className="mt-3 text-[10.5px] text-muted text-right">
                    {typeof draftModal.costMicrocents === 'number' &&
                      `cost ≈ $${(draftModal.costMicrocents / 1_000_000).toFixed(4)}`}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
