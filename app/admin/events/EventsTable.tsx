'use client';
import { useEffect, useMemo, useState } from 'react';
import { DataTable, Column } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';

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

  async function refresh(opts: { eventType?: string; status?: string; source?: string }) {
    setLoading(true);
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
      setEvents(data.events as SystemEvent[]);
    } catch (err) {
      setError(`Network error: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

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
        <div className="ml-auto text-xs text-muted self-center">{events.length} events</div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
      )}

      <DataTable
        columns={COLUMNS}
        rows={events}
        emptyMessage="No events match these filters yet. Run a Discover Places search to populate the log."
      />
    </div>
  );
}
