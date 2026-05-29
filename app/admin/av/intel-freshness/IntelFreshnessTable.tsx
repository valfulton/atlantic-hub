'use client';

/**
 * IntelFreshnessTable (#204)
 *
 * Sortable, filterable table of every lead with the last-refreshed timestamps
 * for each AI artifact (audit / call script / outreach). Color-coded age badges:
 *   green  = under 7 days
 *   amber  = 7-14 days
 *   rose   = over 14 days OR never generated
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { LeadIntelFreshness } from '@/lib/leads/intel_freshness';

type SortKey = 'auditAt' | 'callScriptAt' | 'outreachAt' | 'score' | 'company' | 'client';

function ageDays(iso: string | null): number {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 86_400_000;
}

function AgeBadge({ iso }: { iso: string | null }) {
  if (!iso) {
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-rose-500/15 text-rose-300 border border-rose-500/30"
        title="Never generated"
      >
        never
      </span>
    );
  }
  const days = ageDays(iso);
  let cls = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  let label = `${Math.round(days)}d`;
  if (days < 1) label = '<1d';
  if (days >= 7 && days < 14) cls = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
  if (days >= 14) cls = 'bg-rose-500/15 text-rose-300 border-rose-500/30';
  return (
    <span
      title={new Date(iso).toLocaleString()}
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border ${cls}`}
    >
      {label}
    </span>
  );
}

function ScoreBadge({ score, band }: { score: number | null; band: string | null }) {
  if (score == null) return <span className="text-white/30 text-[11px]">—</span>;
  const cls =
    band === 'hot'
      ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
      : band === 'warm'
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      : 'bg-sky-500/15 text-sky-300 border-sky-500/30';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border ${cls}`}>
      {score} · {band ?? '—'}
    </span>
  );
}

export function IntelFreshnessTable({ leads }: { leads: LeadIntelFreshness[] }) {
  const [query, setQuery] = useState('');
  const [clientFilter, setClientFilter] = useState<'all' | 'house' | 'clients'>('all');
  const [staleFilter, setStaleFilter] = useState<'all' | 'audit-stale' | 'callscript-stale' | 'never-audited'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('auditAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const clients = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of leads) if (l.clientId != null && l.clientName) m.set(l.clientId, l.clientName);
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [leads]);

  const [singleClient, setSingleClient] = useState<number | 'all'>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((l) => {
      if (clientFilter === 'house' && l.clientId != null) return false;
      if (clientFilter === 'clients' && l.clientId == null) return false;
      if (singleClient !== 'all' && l.clientId !== singleClient) return false;
      if (staleFilter === 'audit-stale' && ageDays(l.auditAt) < 14) return false;
      if (staleFilter === 'callscript-stale' && ageDays(l.callScriptAt) < 14) return false;
      if (staleFilter === 'never-audited' && l.auditAt) return false;
      if (q) {
        const blob = [l.company, l.industry, l.contactName, l.clientName].filter(Boolean).join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [leads, query, clientFilter, singleClient, staleFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const get = (l: LeadIntelFreshness): number | string => {
        switch (sortKey) {
          case 'auditAt': return ageDays(l.auditAt);
          case 'callScriptAt': return ageDays(l.callScriptAt);
          case 'outreachAt': return ageDays(l.outreachAt);
          case 'score': return l.aiScore ?? -1;
          case 'company': return l.company.toLowerCase();
          case 'client': return (l.clientName || 'zzzz').toLowerCase();
        }
      };
      const av = get(a);
      const bv = get(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  function setSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(k);
      // Default direction: ascending for ages (stalest first), descending for score.
      setSortDir(k === 'score' ? 'desc' : 'asc');
    }
  }

  const input =
    'rounded-md bg-black/30 border border-white/10 px-2.5 py-1.5 text-[12px] text-white/90 placeholder-white/30 focus:outline-none focus:border-amber-400/50';

  function sortIcon(k: SortKey) {
    if (sortKey !== k) return <span className="text-white/20">·</span>;
    return <span className="text-amber-300">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          className={input + ' flex-1 min-w-[180px]'}
          placeholder="Search company / contact / industry / client…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className={input}
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value as typeof clientFilter)}
        >
          <option value="all">All ownership</option>
          <option value="clients">Client-owned only</option>
          <option value="house">House (unassigned) only</option>
        </select>
        <select
          className={input}
          value={singleClient}
          onChange={(e) => setSingleClient(e.target.value === 'all' ? 'all' : Number(e.target.value))}
        >
          <option value="all">All clients</option>
          {clients.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <select
          className={input}
          value={staleFilter}
          onChange={(e) => setStaleFilter(e.target.value as typeof staleFilter)}
        >
          <option value="all">Any freshness</option>
          <option value="never-audited">Never audited</option>
          <option value="audit-stale">Audit &gt; 14 days</option>
          <option value="callscript-stale">Call script &gt; 14 days</option>
        </select>
        <div className="text-[11px] text-white/50 ml-auto">
          showing {sorted.length} of {leads.length}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-white/40">
              <th className="px-2 py-2 cursor-pointer" onClick={() => setSort('company')}>
                Company {sortIcon('company')}
              </th>
              <th className="px-2 py-2 cursor-pointer" onClick={() => setSort('client')}>
                Client {sortIcon('client')}
              </th>
              <th className="px-2 py-2 cursor-pointer" onClick={() => setSort('score')}>
                Score {sortIcon('score')}
              </th>
              <th className="px-2 py-2 cursor-pointer" onClick={() => setSort('auditAt')}>
                Audit age {sortIcon('auditAt')}
              </th>
              <th className="px-2 py-2 cursor-pointer" onClick={() => setSort('callScriptAt')}>
                Call script age {sortIcon('callScriptAt')}
              </th>
              <th className="px-2 py-2 cursor-pointer" onClick={() => setSort('outreachAt')}>
                Outreach age {sortIcon('outreachAt')}
              </th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((l) => (
              <tr key={l.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                <td className="px-2 py-2 text-white/90">
                  <Link className="hover:text-amber-300 transition" href={`/admin/av/${l.auditId}`}>
                    {l.company}
                  </Link>
                  {l.contactName && <div className="text-[10.5px] text-white/40">{l.contactName}</div>}
                </td>
                <td className="px-2 py-2 text-white/70">
                  {l.clientName ? (
                    <Link className="hover:text-amber-300 transition" href={`/admin/av/clients/${l.clientId}`}>
                      {l.clientName}
                    </Link>
                  ) : (
                    <span className="text-white/30">— house —</span>
                  )}
                </td>
                <td className="px-2 py-2"><ScoreBadge score={l.aiScore} band={l.aiScoreBand} /></td>
                <td className="px-2 py-2"><AgeBadge iso={l.auditAt} /></td>
                <td className="px-2 py-2"><AgeBadge iso={l.callScriptAt} /></td>
                <td className="px-2 py-2"><AgeBadge iso={l.outreachAt} /></td>
                <td className="px-2 py-2 text-right">
                  <Link
                    href={`/admin/av/${l.auditId}`}
                    className="text-[11px] text-amber-300/70 hover:text-amber-300 transition"
                  >
                    open →
                  </Link>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={7} className="text-center text-white/40 py-8">No leads match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[10.5px] text-white/40 leading-relaxed">
        <strong>Age badges:</strong> <span className="text-emerald-300">green</span> under 7 days · <span className="text-amber-300">amber</span> 7–14 days · <span className="text-rose-300">rose</span> over 14 days or never generated. Hover any badge for the exact timestamp. Click a column header to sort.
      </div>
    </div>
  );
}
