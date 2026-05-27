'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DataTable, Column } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';

const LIVE_MODE_KEY = 'ah_events_live_mode';
const LIVE_REFRESH_MS = 5_000;
const HIGHLIGHT_FADE_MS = 2_000;

export interface SystemEvent {
  id: number;
  eventType: string;
  organizationId: number | null;
  leadId: number | null;
  userId: number | null;
  source: string | null;
  payload: unknown;
  status: 'success' | 'failure' | 'partial' | 'pending';
  executionTimeMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}

interface Props {
  initialEvents: SystemEvent[];
  initialFilters: {
    eventType: string | null;
    status: string | null;
    source: string | null;
  };
}

function formatPayload(p: unknown): string {
  if (p === null || p === undefined) return '';
  try {
    const s = JSON.stringify(p);
    return s.length > 240 ? s.slice(0, 240) + '...' : s;
  } catch {
    return String(p);
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

const COLUMNS: Column<SystemEvent>[] = [
  {
    key: 'created',
    header: 'When',
    render: (r) => <span className="text-xs text-muted whitespace-nowrap">{formatTime(r.createdAt)}</span>
  },
  {
    key: 'event_type',
    header: 'Event type',
    render: (r) => <span className="font-mono text-[12px] text-ink">{r.eventType}</span>
  },
  {
    key: 'source',
    header: 'Source',
    render: (r) =>
      r.source ? <span className="text-xs">{r.source}</span> : <span className="text-muted text-xs">—</span>
  },
  {
    key: 'status',
    header: 'Status',
    render: (r) => <StatusBadge value={r.status} />
  },
  {
    key: 'lead',
    header: 'Lead',
    render: (r) =>
      r.leadId !== null ? <span className="text-xs">#{r.leadId}</span> : <span className="text-muted text-xs">—</span>
  },
  {
    key: 'elapsed',
    header: 'Elapsed',
    render: (r) =>
      r.executionTimeMs !== null ? (
        <span className="text-xs">{r.executionTimeMs}ms</span>
      ) : (
        <span className="text-muted text-xs">—</span>
      )
  },
  {
    key: 'payload',
    header: 'Payload / error',
    render: (r) => (
      <div className="max-w-md">
        {r.errorMessage && (
          <div className="text-xs text-rose-300 mb-1 break-words">{r.errorMessage}</div>
        )}
        {r.payload !== null && r.payload !== undefined ? (
          <code className="text-[11px] text-muted break-all">{formatPayload(r.payload)}</code>
        ) : null}
      </div>
    )
  }
];

export function EventsTable({ initialEvents, initialFilters }: Props) {
  const [events, setEvents] = useState<SystemEvent[]>(initialEvents);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventType, setEventType] = useState<string>(initialFilters.eventType ?? '');
  const [status, setStatus] = useState<string>(initialFilters.status ?? '');
  const [source, setSource] = useState<string>(initialFilters.source ?? '');
  // Live mode auto-polls the API every 5s and highlights freshly-arrived rows.
  // Preference persisted to localStorage so each operator's pick sticks.
  const [liveMode, setLiveMode] = useState(false);
  const [newEventIds, setNewEventIds] = useState<Set<number>>(new Set());
  const previousIdsRef = useRef<Set<number>>(new Set(initialEvents.map((e) => e.id)));

  const eventTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of initialEvents) set.add(e.eventType);
    for (const e of events) set.add(e.eventType);
    return Array.from(set).sort();
  }, [events, initialEvents]);

  const sourceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of initialEvents) if (e.source) set.add(e.source);
    for (const e of events) if (e.source) set.add(e.source);
    return Array.from(set).sort();
  }, [events, initialEvents]);

  async function applyFilters() {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (eventType) q.set('eventType', eventType);
      if (status) q.set('status', status);
      if (source) q.set('source', source);
      const res = await fetch(`/api/admin/events?${q.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setEvents(data.events as SystemEvent[]);
    } catch (err) {
      setError(`Network error: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  function clearFilters() {
    setEventType('');
    setStatus('');
    setSource('');
    void refresh({});
  }

  async function refresh(opts: {
    eventType?: string;
    status?: string;
    source?: string;
    silent?: boolean;
  }) {
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (opts.eventType) q.set('eventType', opts.eventType);
      if (opts.status) q.set('status', opts.status);
      if (opts.source) q.set('source', opts.source);
      const res = await fetch(`/api/admin/events?${q.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      const incoming = data.events as SystemEvent[];
      // Detect newly-arrived ids vs prior snapshot. Mark them for the
      // highlight fade so the eye catches what just landed.
      const priorIds = previousIdsRef.current;
      const nowIds = new Set(incoming.map((e) => e.id));
      const fresh = new Set<number>();
      for (const id of nowIds) if (!priorIds.has(id)) fresh.add(id);
      previousIdsRef.current = nowIds;
      setEvents(incoming);
      if (fresh.size > 0 && opts.silent) {
        // Only flash on silent (live-mode) refreshes -- manual Apply
        // shouldn't pulse half the table.
        setNewEventIds(fresh);
        window.setTimeout(() => {
          setNewEventIds((prev) => {
            if (prev === fresh) return new Set();
            const next = new Set(prev);
            for (const id of fresh) next.delete(id);
            return next;
          });
        }, HIGHLIGHT_FADE_MS);
      }
    } catch (err) {
      setError(`Network error: ${(err as Error).message}`);
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }

  // Restore live-mode pref from localStorage on first mount.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LIVE_MODE_KEY);
      if (stored === '1') setLiveMode(true);
    } catch {
      // ignore
    }
  }, []);

  // Persist live-mode pref + manage the polling interval.
  useEffect(() => {
    try {
      window.localStorage.setItem(LIVE_MODE_KEY, liveMode ? '1' : '0');
    } catch {
      // ignore
    }
    if (!liveMode) return;
    // Skip the live refresh while the tab is hidden (no background billing).
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void refresh({
        eventType: eventType || undefined,
        status: status || undefined,
        source: source || undefined,
        silent: true
      });
    }, LIVE_REFRESH_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode, eventType, status, source]);

  // Re-fetch on first mount so the page shows live data even if the SSR
  // pass missed a recent event.
  useEffect(() => {
    void refresh({
      eventType: initialFilters.eventType ?? undefined,
      status: initialFilters.status ?? undefined,
      source: initialFilters.source ?? undefined
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 p-4 bg-surface border border-border rounded-lg">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-muted mb-1">Event type</label>
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm min-w-[200px]"
            style={{ backgroundColor: '#1a1f2e', color: '#f1f5f9' }}
          >
            <option value="">All</option>
            {eventTypeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-muted mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm"
            style={{ backgroundColor: '#1a1f2e', color: '#f1f5f9' }}
          >
            <option value="">All</option>
            <option value="success">success</option>
            <option value="failure">failure</option>
            <option value="partial">partial</option>
            <option value="pending">pending</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-muted mb-1">Source</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm"
            style={{ backgroundColor: '#1a1f2e', color: '#f1f5f9' }}
          >
            <option value="">All</option>
            {sourceOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={applyFilters}
          disabled={loading}
          className="px-4 py-2 rounded-md bg-brand text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {loading ? 'Loading...' : 'Apply'}
        </button>
        <button
          type="button"
          onClick={clearFilters}
          disabled={loading}
          className="px-3 py-2 rounded-md border border-border text-muted hover:text-ink hover:border-brand transition-colors text-sm"
        >
          Clear
        </button>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => setLiveMode((v) => !v)}
            aria-pressed={liveMode}
            title={liveMode ? 'Live mode on -- polling every 5s' : 'Click to auto-refresh every 5s'}
            className={[
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors',
              liveMode
                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-200'
                : 'bg-surface border-border text-muted hover:text-ink hover:border-brand'
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className={liveMode ? 'ah-live-dot' : ''}
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: liveMode ? '#10b981' : 'var(--muted)'
              }}
            />
            <span>Live</span>
            <span className="opacity-80">{liveMode ? 'on' : 'off'}</span>
          </button>
          <div className="text-xs text-muted">{events.length} events</div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
      )}

      <DataTable
        columns={COLUMNS}
        rows={events}
        rowClassName={(row) => (newEventIds.has(row.id) ? 'ah-event-row-fresh' : '')}
        emptyMessage="No events match these filters yet. Run a Discover Places search to populate the log."
      />

      <style jsx global>{`
        .ah-event-row-fresh {
          animation: ah-event-fresh ${HIGHLIGHT_FADE_MS}ms ease-out both;
        }
        @keyframes ah-event-fresh {
          0%   { background-color: rgba(16, 185, 129, 0.22); }
          100% { background-color: transparent; }
        }
        .ah-live-dot {
          animation: ah-live-pulse 1.6s ease-in-out infinite;
          box-shadow: 0 0 8px rgba(16, 185, 129, 0.7);
        }
        @keyframes ah-live-pulse {
          0%, 100% { transform: scale(1);   opacity: 1; }
          50%      { transform: scale(1.4); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
