'use client';

/**
 * IntelligenceFeedPanel  (#380, val 2026-06-03)
 *
 * The "information everywhere" surface. Unified chronological feed of every
 * record from every adapter + every cascade-emitted entity + every worker
 * run for this client. Nothing the engine pulls in goes invisible.
 *
 * Reads `/api/admin/av/clients/[id]/intel-feed`. Polls on open + manual
 * refresh. Filterable by source kind for quick scanning.
 */
import { useEffect, useState, useCallback } from 'react';

type FeedKind = 'record' | 'distress_entity' | 'worker_run';

interface FeedEvent {
  kind: FeedKind;
  at: string;
  summary: string;
  sourceKind: string | null;
  entityKey: string | null;
  score: number | null;
  regionCode: string | null;
}

const SOURCE_COLOR: Record<string, string> = {
  ca_sos: 'text-emerald-300 border-emerald-400/30',
  courtlistener: 'text-blue-300 border-blue-400/30',
  ucc_ca: 'text-[var(--gold-bright)] border-[color-mix(in_srgb,var(--gold-bright)_30%,transparent)]',
  pacer_docket: 'text-rose-300 border-rose-400/30',
  hmda: 'text-cyan-300 border-cyan-400/30',
  cfpb: 'text-orange-300 border-orange-400/30',
  census_acs: 'text-fuchsia-300 border-fuchsia-400/30',
  gbp: 'text-yellow-300 border-yellow-400/30',
  // (#523, val 2026-06-08) Patent lookup persistence — surfaces in this feed
  uspto_patents: 'text-sky-300 border-sky-400/30'
};

function sourceChip(kind: string): string {
  return SOURCE_COLOR[kind] ?? 'text-muted border-border';
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export default function IntelligenceFeedPanel({ clientId, clientName }: { clientId: number; clientName: string }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [filter, setFilter] = useState<'all' | FeedKind>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/av/clients/${clientId}/intel-feed?limit=80`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j.ok) { setError(j.error || 'Could not load.'); return; }
      setEvents(j.events as FeedEvent[]);
      setError(null);
    } catch { setError('Could not load.'); }
  }, [clientId]);

  useEffect(() => {
    if (open && !events) load();
  }, [open, events, load]);

  const visible = events?.filter((e) => filter === 'all' || e.kind === filter) ?? [];

  return (
    <div className="rounded-2xl border border-border bg-surface overflow-hidden mb-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={
          'w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors ' +
          (open ? 'bg-sky-400/[0.08] hover:bg-sky-400/[0.12]' : 'bg-sky-400/[0.04] hover:bg-sky-400/[0.08]')
        }
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            aria-hidden
            className="shrink-0 w-7 h-7 rounded-md bg-sky-400/15 border border-sky-400/30 flex items-center justify-center text-sky-300 text-sm"
          >
            ≋
          </span>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.14em] text-sky-300">Intelligence feed</div>
            <div className="text-sm text-ink/95 mt-0.5">
              Every record · every cascade · every refresh for {clientName} — chronological
            </div>
          </div>
        </div>
        <span className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-sky-300/80">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>
      {open && (
        <div className="px-4 py-4 border-t border-sky-400/20">
          <p className="text-[11px] text-muted mb-3 leading-snug">
            Nothing the engine pulls goes invisible. Every adapter run + every cascade emission + every distress
            score change shows up here, newest first. Filter to scan a single source.
          </p>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <button
              type="button"
              onClick={load}
              className="rounded-lg border border-sky-400/40 bg-sky-400/10 hover:bg-sky-400/20 text-sky-200 text-[12px] px-3 py-1.5"
            >
              ↻ Refresh
            </button>
            <div className="flex items-center rounded-md border border-border bg-black/30 text-[11px] overflow-hidden">
              {(['all', 'record', 'distress_entity', 'worker_run'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 ${filter === f ? 'bg-brand text-black font-medium' : 'text-muted hover:text-ink'}`}
                >
                  {f === 'all' ? 'All' : f === 'record' ? 'Records' : f === 'distress_entity' ? 'Scored' : 'Refreshes'}
                </button>
              ))}
            </div>
          </div>
          {error && (
            <div className="mb-3 text-[11px] text-danger rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2">{error}</div>
          )}
          {!events && <div className="text-[11px] text-muted">Loading…</div>}
          {events && visible.length === 0 && (
            <div className="text-[12px] text-muted leading-snug">
              No events yet. Enable adapters in <strong className="text-ink">Public intelligence</strong>, then click
              <strong className="text-ink"> Run now</strong> on one. The first records will appear here within seconds.
            </div>
          )}
          {events && visible.length > 0 && (
            <ul className="grid gap-1.5">
              {visible.map((e, i) => {
                // (#523, val 2026-06-08) Row should be CLICKABLE to the record
                // detail page when there's an entityKey. Without this, val sees
                // "Bankruptcy Court Virginia · 2029-01-01" but can't drill in
                // to see the parties / docket / raw JSON. Same fix pattern as
                // the watchlist row click (#520). Worker-run rows (entityKey
                // null) stay as plain <li> — there's no detail page for those.
                const detailHref = e.entityKey
                  ? `/admin/av/clients/${clientId}/distress/${encodeURIComponent(e.entityKey)}`
                  : null;
                const inner = (
                  <>
                    <span className="text-[10.5px] text-muted tabular-nums">{relTime(e.at)}</span>
                    {e.sourceKind ? (
                      <span className={`text-[10px] uppercase tracking-[0.1em] rounded px-1.5 py-0.5 border ${sourceChip(e.sourceKind)}`}>
                        {e.sourceKind}
                      </span>
                    ) : e.kind === 'distress_entity' ? (
                      <span className="text-[10px] uppercase tracking-[0.1em] rounded px-1.5 py-0.5 border border-red-400/30 text-red-300">
                        scored
                      </span>
                    ) : (
                      <span className="text-[10px] uppercase tracking-[0.1em] rounded px-1.5 py-0.5 border border-violet-400/30 text-violet-300">
                        refresh
                      </span>
                    )}
                    <span className="text-[12px] text-ink/90 truncate">{e.summary}</span>
                    {e.regionCode && <span className="text-[10px] text-muted shrink-0">{e.regionCode}</span>}
                  </>
                );
                const rowCls = 'grid grid-cols-[80px_auto_minmax(0,1fr)_auto] items-baseline gap-2 rounded-md border border-border/60 bg-bg/30 px-3 py-1.5';
                return detailHref ? (
                  <li key={i}>
                    <a
                      href={detailHref}
                      className={`${rowCls} hover:bg-bg/60 hover:border-[color-mix(in_srgb,var(--gold-bright)_30%,transparent)] transition-colors group cursor-pointer`}
                      title="See every field we pulled on this entity"
                    >
                      {inner}
                    </a>
                  </li>
                ) : (
                  <li key={i} className={rowCls}>
                    {inner}
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
