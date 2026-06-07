/**
 * /admin/av/watchlist — UNIFIED WATCHLIST
 *
 * Cross-client view of every distress watchlist entry. Filter by client,
 * signal kind, recency, min score. Search by entity name. Each row links
 * to the originating client's distress panel.
 *
 * The "buried" search val flagged is now a single page with GET-param
 * filters. Linkable from anywhere — including the onboarding step strip
 * on /admin/av/clients/[id].
 */
import Link from 'next/link';
import {
  listUnifiedWatchlist,
  listClientsWithWatchlist,
  listSignalKinds
} from '@/lib/public_intel/all_watchlists';
import FilterSheet from './FilterSheet';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Query {
  client?: string;
  kind?: string;
  min?: string;
  days?: string;
  q?: string;
}

// (val 2026-06-05) Forced chevron on the filter <select>s so they read as
// dropdowns, not blank text boxes, on the dark operator theme. Inline SVG
// chevron in muted gray; appearance:none kills the invisible native arrow.
const dropdownStyle: React.CSSProperties = {
  appearance: 'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 20 20' fill='%2394a3b8'><path d='M5.5 7.5 10 12l4.5-4.5z'/></svg>\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0.6rem center',
  backgroundSize: '0.8rem'
};

function fmtRel(d: Date): string {
  const ms = Date.now() - d.getTime();
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return d.toLocaleDateString();
}

export default async function UnifiedWatchlistPage({ searchParams }: { searchParams?: Query }) {
  const clientId = searchParams?.client ? Number.parseInt(searchParams.client, 10) : null;
  const kind = searchParams?.kind || null;
  const minScore = searchParams?.min ? Number.parseInt(searchParams.min, 10) : 0;
  const days = searchParams?.days ? Number.parseInt(searchParams.days, 10) : null;
  const q = searchParams?.q || null;
  const activeCount = [clientId, kind, minScore > 0 ? minScore : null, days, q].filter((v) => v != null && v !== '').length;

  const [rows, clientChoices, kindChoices] = await Promise.all([
    listUnifiedWatchlist({ clientId, signalKind: kind, minScore, withinDays: days, q, limit: 200 }),
    listClientsWithWatchlist(),
    listSignalKinds()
  ]);

  const totalRows = rows.length;
  const totalScore = rows.reduce((s, r) => s + r.score, 0);
  const avgScore = totalRows ? Math.round((totalScore / totalRows) * 10) / 10 : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <header className="mb-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted mb-2">
          Operator · Cross-client view
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">
          Unified watchlist
        </h1>
        <p className="text-muted mt-2 max-w-3xl text-sm leading-relaxed">
          Every entity flagged across every client&apos;s public-records feed, score-descending.
          Filter, search, and jump to the client where it was flagged. Use this during onboarding
          to confirm a new client&apos;s feed is firing.
        </p>
      </header>

      {/* Filters — GET-param form so deep-linking works (e.g. ?client=9&days=7).
          Wrapped in FilterSheet: collapses to a "Filters · N" chip + bottom-sheet
          on phones; inline on desktop (val 2026-06-07 operator-mobile). */}
      <FilterSheet activeCount={activeCount}>
      <form
        method="GET"
        className="rounded-2xl border border-border bg-surface p-4 mb-6"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.7rem' }}
      >
        {/* val 2026-06-05: dark-theme native <select> chevron was invisible →
            filter read as empty text boxes. Forcing an explicit chevron SVG via
            inline style + appearance:none so each dropdown OBVIOUSLY pulls down.
            Inputs (number / search) keep the plain look so they read distinct
            from the selects. */}
        <label className="block">
          <span className="block text-[10px] uppercase tracking-[0.14em] text-muted mb-1">Client</span>
          <select
            name="client"
            defaultValue={clientId ?? ''}
            className="w-full bg-bg/40 border border-border rounded-md pl-2 pr-8 py-1.5 text-[13px] text-ink cursor-pointer"
            style={dropdownStyle}
          >
            <option value="">All clients</option>
            {clientChoices.map((c) => (
              <option key={c.clientId} value={c.clientId}>{c.clientName} ({c.count})</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-[0.14em] text-muted mb-1">Signal kind</span>
          <select
            name="kind"
            defaultValue={kind ?? ''}
            className="w-full bg-bg/40 border border-border rounded-md pl-2 pr-8 py-1.5 text-[13px] text-ink cursor-pointer"
            style={dropdownStyle}
          >
            <option value="">All kinds</option>
            {kindChoices.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-[0.14em] text-muted mb-1">Min score</span>
          <input
            type="number"
            name="min"
            min="0"
            max="100"
            defaultValue={minScore || ''}
            placeholder="0"
            className="w-full bg-bg/40 border border-border rounded-md px-2 py-1.5 text-[13px] text-ink"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-[0.14em] text-muted mb-1">Recency</span>
          <select
            name="days"
            defaultValue={days ?? ''}
            className="w-full bg-bg/40 border border-border rounded-md pl-2 pr-8 py-1.5 text-[13px] text-ink cursor-pointer"
            style={dropdownStyle}
          >
            <option value="">Any time</option>
            <option value="1">Last 24h</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </label>
        <label className="block sm:col-span-2" style={{ gridColumn: 'span 2' }}>
          <span className="block text-[10px] uppercase tracking-[0.14em] text-muted mb-1">Search by entity name</span>
          <input
            type="text"
            name="q"
            defaultValue={q ?? ''}
            placeholder="e.g. Meridian, Harbor, Calumet…"
            className="w-full bg-bg/40 border border-border rounded-md px-2 py-1.5 text-[13px] text-ink"
          />
        </label>
        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="rounded-lg border border-[var(--gold-bright)] text-[var(--gold-bright)] hover:bg-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)] text-[12.5px] px-4 py-1.5 font-medium"
          >
            Apply
          </button>
          <Link
            href="/admin/av/watchlist"
            className="text-[11.5px] text-muted hover:text-ink pb-2"
          >
            Reset
          </Link>
        </div>
      </form>
      </FilterSheet>

      {/* Summary strip */}
      <div className="flex flex-wrap gap-4 mb-6 text-[12px]">
        <div className="rounded-md border border-border bg-surface px-3 py-1.5">
          <span className="text-muted">Entries · </span>
          <span className="text-ink font-medium">{totalRows}</span>
        </div>
        <div className="rounded-md border border-border bg-surface px-3 py-1.5">
          <span className="text-muted">Avg score · </span>
          <span className="text-ink font-medium">{avgScore}</span>
        </div>
        <div className="rounded-md border border-border bg-surface px-3 py-1.5">
          <span className="text-muted">Clients on watch · </span>
          <span className="text-ink font-medium">
            {new Set(rows.map((r) => r.clientId)).size}
          </span>
        </div>
      </div>

      {/* Rows */}
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <p className="text-ink font-medium">No watchlist entries match these filters.</p>
          <p className="text-muted mt-2 text-sm">
            Try clearing filters, or apply a vertical pack on a client + run public-intel sources to populate.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const entityRef = encodeURIComponent(r.entityKey);
            const trail = r.contributingSignals.slice(0, 4);
            return (
              <li
                key={`${r.clientId}-${r.entityKey}`}
                className="rounded-2xl border border-border bg-surface p-4 hover:border-[color-mix(in_srgb,var(--gold-bright)_40%,transparent)] transition-colors"
              >
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="shrink-0 w-14 h-14 rounded-xl bg-gradient-to-br from-[color-mix(in_srgb,var(--gold-bright)_20%,transparent)] to-[color-mix(in_srgb,var(--gold-bright)_5%,transparent)] border border-[color-mix(in_srgb,var(--gold-bright)_30%,transparent)] grid place-items-center">
                    <span className="text-[var(--gold-bright)] font-semibold text-lg">{Math.round(r.score)}</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="text-ink font-semibold text-[15px] truncate">
                        <Link
                          href={`/admin/av/clients/${r.clientId}/preview/watchlist#${entityRef}`}
                          className="hover:text-[var(--gold-bright)] hover:underline transition-colors"
                          title="Open this entity in the client view"
                        >
                          {r.entityLabel || r.entityKey}
                        </Link>
                      </h3>
                      {r.regionCode && (
                        <span className="text-[10px] uppercase tracking-wider text-muted">{r.regionCode}</span>
                      )}
                      {r.lastAction && (
                        <span className="text-[10px] uppercase tracking-wider text-[color-mix(in_srgb,var(--gold-bright)_80%,transparent)] border border-[color-mix(in_srgb,var(--gold-bright)_30%,transparent)] rounded-full px-2 py-0.5">
                          {r.lastAction}
                        </span>
                      )}
                    </div>

                    <div className="text-[12px] text-muted mb-2">
                      Flagged for{' '}
                      <Link
                        href={`/admin/av/clients/${r.clientId}`}
                        className="text-[var(--gold-bright)] hover:underline"
                      >
                        {r.clientName}
                      </Link>{' '}
                      · {fmtRel(r.firstSeenAt)} · last refreshed {fmtRel(r.lastRecomputedAt)}
                    </div>

                    <div className="flex flex-wrap items-center gap-1 mb-3">
                      {trail.map((s, i) => (
                        <span key={i} className="inline-flex items-center gap-1">
                          <span className={
                            i === trail.length - 1
                              ? 'text-[11px] text-[var(--gold-bright)] border border-[color-mix(in_srgb,var(--gold-bright)_40%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)] rounded-md px-2 py-0.5'
                              : 'text-[11px] text-muted border border-border rounded-md px-2 py-0.5'
                          }>{s.label}</span>
                          {i < trail.length - 1 && <span className="text-muted text-[11px]">→</span>}
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2 text-[11.5px]">
                      {/* (val 2026-06-07) Primary discovery action: see every
                          raw record the engine has on this entity — the
                          full payload, derived signals, promoted-lead link. */}
                      <Link
                        href={`/admin/av/clients/${r.clientId}/distress/${entityRef}`}
                        className="text-[var(--gold-bright)] hover:underline font-medium"
                        title="See every field we pulled on this entity"
                      >
                        📂 View intel →
                      </Link>
                      <span className="text-muted">·</span>
                      <Link
                        href={`/admin/av/clients/${r.clientId}/preview/watchlist#${entityRef}`}
                        className="text-muted hover:text-ink"
                      >
                        Open in client view
                      </Link>
                      <span className="text-muted">·</span>
                      <Link
                        href={`/admin/av/clients/${r.clientId}#distress`}
                        className="text-muted hover:text-ink"
                      >
                        Tune signal weights
                      </Link>
                      <span className="text-muted">·</span>
                      <Link
                        href={`/admin/av/clients/${r.clientId}#distress`}
                        className="text-muted hover:text-ink"
                        title="The real promote action lives on the per-client distress panel"
                      >
                        Promote on client page →
                      </Link>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
