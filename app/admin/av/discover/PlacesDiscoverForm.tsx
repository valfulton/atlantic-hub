'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DestinationSelect, parseDestination, type ClientOption, type EmployeeOption } from './DestinationSelect';

/**
 * Google Places Text Search → leads. Hospitality-friendly so it covers the
 * USVI businesses Apollo doesn't index (boutique hotels, restaurants, marinas).
 *
 * USAGE PATTERN:
 *   1. Pick a preset or type a free-text query
 *   2. Optionally constrain to a primary type (restaurant / lodging / etc.)
 *   3. Run — results show as a table of inserts / dupes / unworkable hits
 */

interface Result {
  placeId: string;
  outcome: string;
  leadId?: number;
  details: {
    company: string;
    domain?: string;
    industry?: string | null;
    primaryType?: string | null;
    rating?: number | null;
    userRatingCount?: number | null;
    error?: string;
  };
}

interface BatchResponse {
  source: string;
  resultsCount: number;
  insertedCount: number;
  duplicateCount: number;
  nextPageToken: string | null;
  results: Result[];
  error?: string;
  detail?: string;
}

const QUERY_PRESETS = [
  { label: 'Restaurants — St. Croix', query: 'restaurants in St. Croix US Virgin Islands', includedType: 'restaurant' },
  { label: 'Hotels & resorts — USVI', query: 'hotels and resorts US Virgin Islands', includedType: 'lodging' },
  { label: 'Event venues — USVI', query: 'event venues and wedding venues US Virgin Islands', includedType: 'event_venue' },
  { label: 'Marinas — USVI', query: 'marinas in US Virgin Islands', includedType: '' },
  { label: 'Boutique hotels — Annapolis', query: 'boutique hotels Annapolis Maryland', includedType: 'lodging' },
  { label: 'Wedding planners — Northeast', query: 'wedding planners and event planners northeast US', includedType: '' }
];

const INCLUDED_TYPE_OPTIONS = [
  { value: '', label: 'No type filter' },
  { value: 'restaurant', label: 'restaurant' },
  { value: 'lodging', label: 'lodging (hotels)' },
  { value: 'bar', label: 'bar' },
  { value: 'event_venue', label: 'event_venue' },
  { value: 'tourist_attraction', label: 'tourist_attraction' },
  { value: 'cafe', label: 'cafe' },
  { value: 'bakery', label: 'bakery' }
];

export function PlacesDiscoverForm({
  clients = [],
  employees = []
}: {
  clients?: ClientOption[];
  employees?: EmployeeOption[];
}) {
  const router = useRouter();
  const [textQuery, setTextQuery] = useState('');
  const [includedType, setIncludedType] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchResponse | null>(null);
  const [dest, setDest] = useState('');

  function applyPreset(p: (typeof QUERY_PRESETS)[number]) {
    setTextQuery(p.query);
    setIncludedType(p.includedType);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!textQuery.trim()) {
      setError('Type a search query first.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/av/discover/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          textQuery: textQuery.trim(),
          includedType: includedType || undefined,
          pageSize,
          ...parseDestination(dest)
        })
      });
      const json: BatchResponse = await res.json();
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
        return;
      }
      setResult(json);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = { backgroundColor: '#1a1f2e', color: '#f1f5f9' };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted mb-3">
          Google Places (New) Text Search → Place Details → inserts as a lead with website + phone.
          Free tier covers ~6k searches/month on the $200 Maps Platform credit. Best for
          hospitality businesses Apollo misses.
        </p>
        <div className="text-xs text-muted mb-2 uppercase tracking-wider">Presets</div>
        <div className="flex flex-wrap gap-2">
          {QUERY_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p)}
              className="text-xs px-2.5 py-1 rounded-full bg-surface border border-border hover:border-brand text-muted hover:text-ink transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <DestinationSelect value={dest} onChange={setDest} clients={clients} employees={employees} />
        <div>
          <label className="block text-xs uppercase tracking-wider text-muted mb-1">Text query</label>
          <input
            type="text"
            value={textQuery}
            onChange={(e) => setTextQuery(e.target.value)}
            placeholder='e.g. "boutique hotels in St. Croix"'
            className="w-full px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none"
            style={inputStyle}
            required
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-1">Limit to type</label>
            <select
              value={includedType}
              onChange={(e) => setIncludedType(e.target.value)}
              className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none"
              style={inputStyle}
            >
              {INCLUDED_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-1">Results</label>
            <input
              type="number"
              min={1}
              max={20}
              value={pageSize}
              onChange={(e) => setPageSize(Math.min(20, Math.max(1, Number(e.target.value) || 20)))}
              className="w-20 px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none"
              style={inputStyle}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 rounded-md bg-brand text-black font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Searching…' : 'Search Google Places'}
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {result && <PlacesResultPanel result={result} />}
    </div>
  );
}

function PlacesResultPanel({ result }: { result: BatchResponse }) {
  return (
    <div className="rounded-md border border-border p-4" style={{ backgroundColor: '#0e1420' }}>
      <div className="flex flex-wrap gap-4 text-sm mb-3">
        <Stat label="Found" value={result.resultsCount} />
        <Stat label="Inserted" value={result.insertedCount} tone="green" />
        <Stat label="Duplicates" value={result.duplicateCount} tone="amber" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted border-b border-border">
            <tr>
              <th className="text-left py-1 pr-3">Outcome</th>
              <th className="text-left py-1 pr-3">Business</th>
              <th className="text-left py-1 pr-3">Domain</th>
              <th className="text-left py-1 pr-3">Industry</th>
              <th className="text-left py-1 pr-3">Rating</th>
            </tr>
          </thead>
          <tbody>
            {result.results.map((r, i) => (
              <tr key={`${r.placeId}-${i}`} className="border-b border-border/40">
                <td className="py-1 pr-3"><OutcomePill outcome={r.outcome} /></td>
                <td className="py-1 pr-3">{r.details.company}</td>
                <td className="py-1 pr-3 text-muted">{r.details.domain ?? '—'}</td>
                <td className="py-1 pr-3 text-muted">{r.details.industry ?? '—'}</td>
                <td className="py-1 pr-3 text-muted">
                  {r.details.rating ? `${r.details.rating} (${r.details.userRatingCount ?? 0})` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'amber' }) {
  const color = tone === 'green' ? 'text-green-400' : tone === 'amber' ? 'text-[var(--gold-bright)]' : 'text-ink';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function OutcomePill({ outcome }: { outcome: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    inserted: { label: 'INSERTED', cls: 'bg-green-500/15 text-green-300 border-green-500/30' },
    duplicate_existing: { label: 'DUPLICATE', cls: 'bg-[color-mix(in_srgb,var(--gold-bright)_12%,transparent)] text-[var(--gold-bright)] border-[color-mix(in_srgb,var(--gold-bright)_30%,transparent)]' },
    duplicate_target_upgraded: { label: 'DUP → AV+EBW', cls: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
    no_phone_or_website: { label: 'NO CONTACT', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
    insert_failed: { label: 'FAILED', cls: 'bg-red-500/15 text-red-300 border-red-500/30' }
  };
  const m = map[outcome] || { label: outcome.toUpperCase(), cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' };
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${m.cls}`}>{m.label}</span>;
}
