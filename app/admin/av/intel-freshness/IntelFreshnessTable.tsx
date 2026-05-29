'use client';

/**
 * IntelFreshnessTable (#204, action layer added in #205)
 *
 * Sortable, filterable, ACTION-FIRST table of every lead with the last-refreshed
 * timestamps for each AI artifact. Per-row "Refresh" + multi-select bulk
 * "Refresh selected" so val never has to leave this page to fix stale intel.
 *
 * Color-coded age badges:
 *   green  = under 7 days
 *   amber  = 7-14 days
 *   rose   = over 14 days OR never generated
 */
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
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

interface BulkResult {
  requestedLeads: number;
  matchedLeads: number;
  audits: { reset: number; regenerated: number; failed: number };
  callScripts: { reset: number; regenerated: number; failed: number };
  outreach: { deleted: number };
  stoppedEarly: boolean;
  elapsedMs: number;
}

export function IntelFreshnessTable({ leads }: { leads: LeadIntelFreshness[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [clientFilter, setClientFilter] = useState<'all' | 'house' | 'clients'>('all');
  const [singleClient, setSingleClient] = useState<number | 'all'>('all');
  const [staleFilter, setStaleFilter] = useState<'all' | 'audit-stale' | 'callscript-stale' | 'never-audited'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('auditAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Selection state (audit_id set)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // What to refresh (used by both per-row and bulk actions)
  const [refreshAudits, setRefreshAudits] = useState(true);
  const [refreshCallScripts, setRefreshCallScripts] = useState(true);
  const [refreshOutreach, setRefreshOutreach] = useState(false);

  // Per-row in-flight state (audit_id -> 'pending')
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [lastResult, setLastResult] = useState<BulkResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  // (#206) Bulk progress -- how many batches done out of total.
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const clients = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of leads) if (l.clientId != null && l.clientName) m.set(l.clientId, l.clientName);
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [leads]);

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

  const allVisibleSelected = sorted.length > 0 && sorted.every((l) => selected.has(l.auditId));
  const someVisibleSelected = sorted.some((l) => selected.has(l.auditId));

  function toggleAllVisible() {
    if (allVisibleSelected) {
      const next = new Set(selected);
      for (const l of sorted) next.delete(l.auditId);
      setSelected(next);
    } else {
      const next = new Set(selected);
      for (const l of sorted) next.add(l.auditId);
      setSelected(next);
    }
  }

  function toggleOne(auditId: string) {
    const next = new Set(selected);
    if (next.has(auditId)) next.delete(auditId);
    else next.add(auditId);
    setSelected(next);
  }

  function setSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(k);
      setSortDir(k === 'score' ? 'desc' : 'asc');
    }
  }

  async function callRefresh(auditIds: string[]): Promise<BulkResult> {
    const res = await fetch('/api/admin/av/leads/refresh-intel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auditIds,
        audits: refreshAudits,
        callScripts: refreshCallScripts,
        outreach: refreshOutreach
      })
    });
    // (#206 follow-up) Read as text first so a non-JSON Netlify timeout/error
    // page surfaces as a real status code instead of the cryptic JS error
    // "the string did not match the expected pattern" from res.json() choking
    // on HTML. When Netlify hits its 60s ceiling mid-batch the response IS HTML.
    const rawText = await res.text();
    let data: (BulkResult & { error?: string; message?: string }) | null = null;
    try {
      data = JSON.parse(rawText) as BulkResult & { error?: string; message?: string };
    } catch {
      // Non-JSON response -- almost always a Netlify gateway timeout or
      // platform-level error page. Tell val what actually happened.
      throw new Error(
        `Server returned HTTP ${res.status} (non-JSON). Likely a Netlify 60s timeout mid-batch. ` +
        `Reduce the batch size and try again, or refresh one row at a time.`
      );
    }
    if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
    return data;
  }

  async function refreshRow(auditId: string, company: string) {
    if (!refreshAudits && !refreshCallScripts && !refreshOutreach) {
      setLastError('Pick at least one artifact to refresh (top of the page).');
      return;
    }
    const nextBusy = new Set(rowBusy);
    nextBusy.add(auditId);
    setRowBusy(nextBusy);
    setLastError(null);
    try {
      const result = await callRefresh([auditId]);
      setLastResult(result);
    } catch (err) {
      setLastError(`${company}: ${(err as Error).message}`);
    } finally {
      const after = new Set(rowBusy);
      after.delete(auditId);
      setRowBusy(after);
      router.refresh();
    }
  }

  async function refreshSelected() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!refreshAudits && !refreshCallScripts && !refreshOutreach) {
      setLastError('Pick at least one artifact to refresh.');
      return;
    }
    const parts: string[] = [];
    if (refreshAudits) parts.push('audits');
    if (refreshCallScripts) parts.push('call scripts');
    if (refreshOutreach) parts.push('outreach drafts');
    const sentence = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];

    // (#206 + #221) Pick a safe chunk size so each backend request finishes
    // within the 60s Netlify ceiling. After #201/#202's longer Mode-A prompts,
    // individual gpt-4o-mini calls can run 12-20s. We aim for ~30s of inline
    // work per request (matching the server's SOFT_DEADLINE_MS).
    const heavyArtifacts = (refreshAudits ? 1 : 0) + (refreshCallScripts ? 1 : 0);
    const chunkSize = heavyArtifacts >= 2 ? 2 : heavyArtifacts === 1 ? 3 : 50;
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      batches.push(ids.slice(i, i + chunkSize));
    }

    const confirmed = window.confirm(
      `Refresh ${sentence} for ${ids.length} lead${ids.length === 1 ? '' : 's'}?` +
      (batches.length > 1 ? `\n\nWill run in ${batches.length} batches of up to ${chunkSize} leads each (each batch takes ~30-45s). Stay on this page until it finishes.` : '\n\nRuns OpenAI for each audit and call script, can take up to 45s.') +
      `\n\nAlready-sent emails are never touched.`
    );
    if (!confirmed) return;

    setBulkBusy(true);
    setLastError(null);
    setLastResult(null);
    setBulkProgress({ done: 0, total: batches.length });

    // Accumulate counts across batches
    const accum: BulkResult = {
      requestedLeads: 0,
      matchedLeads: 0,
      audits: { reset: 0, regenerated: 0, failed: 0 },
      callScripts: { reset: 0, regenerated: 0, failed: 0 },
      outreach: { deleted: 0 },
      stoppedEarly: false,
      elapsedMs: 0
    };
    const startedAt = Date.now();

    try {
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const r = await callRefresh(batch);
        accum.requestedLeads += r.requestedLeads;
        accum.matchedLeads += r.matchedLeads;
        accum.audits.reset += r.audits.reset;
        accum.audits.regenerated += r.audits.regenerated;
        accum.audits.failed += r.audits.failed;
        accum.callScripts.reset += r.callScripts.reset;
        accum.callScripts.regenerated += r.callScripts.regenerated;
        accum.callScripts.failed += r.callScripts.failed;
        accum.outreach.deleted += r.outreach.deleted;
        if (r.stoppedEarly) accum.stoppedEarly = true;
        setBulkProgress({ done: i + 1, total: batches.length });
        // Live-update the result banner so val sees counts climbing.
        setLastResult({ ...accum, elapsedMs: Date.now() - startedAt });
      }
      accum.elapsedMs = Date.now() - startedAt;
      setLastResult(accum);
      setSelected(new Set());
    } catch (err) {
      setLastError(
        `Stopped after ${bulkProgress?.done ?? 0} of ${batches.length} batches: ${(err as Error).message}. ` +
        `Columns are already nulled for the batches that ran -- select the remaining rows and click Refresh again.`
      );
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
      router.refresh();
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
      {/* What each artifact actually means — collapsible help. */}
      <div className="mb-3">
        <button
          type="button"
          className="text-[11px] text-amber-300/70 hover:text-amber-300 transition"
          onClick={() => setShowHelp((v) => !v)}
        >
          {showHelp ? '▾ what each artifact does' : '▸ what each artifact does'}
        </button>
        {showHelp && (
          <div className="mt-2 rounded-md border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2 text-[11.5px] text-white/70 leading-relaxed space-y-1">
            <div><strong className="text-amber-300">Audit</strong> = the AI score (0–100) AND the audit content (call brief or marketing audit, depending on lens). One OpenAI call regenerates both. This is what the &quot;Re-score&quot; button on the lead page does.</div>
            <div><strong className="text-amber-300">Call script</strong> = the &quot;WHAT TO SAY ON THE CALL&quot; pain profile (conversation starters, do-not-say list). Separate OpenAI call. Runs in a daily sweep otherwise.</div>
            <div><strong className="text-amber-300">Outreach</strong> = drafted cold-email subject + body, per campaign. On-demand only — only generated when you click &quot;Generate draft&quot; on a campaign. Refreshing here DELETES unsent drafts (already-sent emails are never touched).</div>
          </div>
        )}
      </div>

      {/* Action toolbar — what to refresh + selection actions. Sticky at top. */}
      <div className="mb-3 rounded-md border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-white/80">
          <span className="text-[10px] uppercase tracking-[0.12em] text-amber-300/80">Refresh action</span>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={refreshAudits} onChange={(e) => setRefreshAudits(e.target.checked)} />
            Audits
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={refreshCallScripts} onChange={(e) => setRefreshCallScripts(e.target.checked)} />
            Call scripts
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={refreshOutreach} onChange={(e) => setRefreshOutreach(e.target.checked)} />
            Outreach drafts (delete unsent)
          </label>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[11px] text-white/50">{selected.size} selected</span>
            <button
              onClick={refreshSelected}
              disabled={selected.size === 0 || bulkBusy}
              className={
                'rounded-md px-3 py-1.5 text-[12px] font-medium transition ' +
                (selected.size === 0 || bulkBusy
                  ? 'bg-white/10 text-white/40 cursor-not-allowed'
                  : 'bg-amber-400/90 text-black hover:bg-amber-300')
              }
            >
              {bulkBusy
                ? bulkProgress
                  ? `Batch ${bulkProgress.done}/${bulkProgress.total}…`
                  : 'Refreshing…'
                : 'Refresh selected'}
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
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
        <div className="text-[11px] text-white/50 ml-auto">showing {sorted.length} of {leads.length}</div>
      </div>

      {/* Last result / error banner */}
      {lastError && (
        <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
          {lastError}
        </div>
      )}
      {lastResult && (
        <div className="mb-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[12px] text-emerald-100 space-y-1">
          <div>
            Touched <strong>{lastResult.matchedLeads}</strong> of {lastResult.requestedLeads} lead{lastResult.requestedLeads === 1 ? '' : 's'} in {Math.round(lastResult.elapsedMs / 100) / 10}s.
          </div>
          {refreshAudits && (
            <div>· Audits: reset {lastResult.audits.reset}, regenerated {lastResult.audits.regenerated}{lastResult.audits.failed > 0 && `, failed ${lastResult.audits.failed}`}</div>
          )}
          {refreshCallScripts && (
            <div>· Call scripts: reset {lastResult.callScripts.reset}, regenerated {lastResult.callScripts.regenerated}{lastResult.callScripts.failed > 0 && `, failed ${lastResult.callScripts.failed}`}</div>
          )}
          {refreshOutreach && <div>· Outreach drafts deleted: {lastResult.outreach.deleted}</div>}
          {lastResult.stoppedEarly && (
            <div className="text-amber-200">Hit the 55s soft deadline mid-batch. Click again to drain the rest — the columns are already nulled.</div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.12em] text-white/40">
              <th className="px-2 py-2 w-6">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected; }}
                  onChange={toggleAllVisible}
                  title={allVisibleSelected ? 'Deselect all visible' : 'Select all visible'}
                />
              </th>
              <th className="px-2 py-2 cursor-pointer" onClick={() => setSort('company')}>Company {sortIcon('company')}</th>
              <th className="px-2 py-2 cursor-pointer" onClick={() => setSort('client')}>Client {sortIcon('client')}</th>
              <th className="px-2 py-2 cursor-pointer" onClick={() => setSort('score')}>Score {sortIcon('score')}</th>
              <th className="px-2 py-2 cursor-pointer" onClick={() => setSort('auditAt')}>Audit age {sortIcon('auditAt')}</th>
              <th className="px-2 py-2 cursor-pointer" onClick={() => setSort('callScriptAt')}>Call script age {sortIcon('callScriptAt')}</th>
              <th className="px-2 py-2 cursor-pointer" onClick={() => setSort('outreachAt')}>Outreach age {sortIcon('outreachAt')}</th>
              <th className="px-2 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((l) => {
              const busy = rowBusy.has(l.auditId);
              const checked = selected.has(l.auditId);
              return (
                <tr key={l.id} className={'border-t border-white/5 ' + (checked ? 'bg-amber-400/[0.04]' : 'hover:bg-white/[0.02]')}>
                  <td className="px-2 py-2 align-top">
                    <input type="checkbox" checked={checked} onChange={() => toggleOne(l.auditId)} />
                  </td>
                  <td className="px-2 py-2 text-white/90">
                    <Link className="hover:text-amber-300 transition" href={`/admin/av/${l.auditId}`}>{l.company}</Link>
                    {l.contactName && <div className="text-[10.5px] text-white/40">{l.contactName}</div>}
                  </td>
                  <td className="px-2 py-2 text-white/70">
                    {l.clientName ? (
                      <Link className="hover:text-amber-300 transition" href={`/admin/av/clients/${l.clientId}`}>{l.clientName}</Link>
                    ) : (
                      <span className="text-white/30">— house —</span>
                    )}
                  </td>
                  <td className="px-2 py-2"><ScoreBadge score={l.aiScore} band={l.aiScoreBand} /></td>
                  <td className="px-2 py-2"><AgeBadge iso={l.auditAt} /></td>
                  <td className="px-2 py-2"><AgeBadge iso={l.callScriptAt} /></td>
                  <td className="px-2 py-2"><AgeBadge iso={l.outreachAt} /></td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => refreshRow(l.auditId, l.company)}
                      disabled={busy || bulkBusy}
                      className={
                        'rounded-md px-2 py-1 text-[10.5px] font-medium uppercase tracking-wider transition border ' +
                        (busy || bulkBusy
                          ? 'border-white/10 text-white/30 cursor-not-allowed'
                          : 'border-amber-400/40 text-amber-300 hover:bg-amber-400/10')
                      }
                    >
                      {busy ? '…' : 'refresh'}
                    </button>
                    <Link href={`/admin/av/${l.auditId}`} className="ml-2 text-[10.5px] text-white/40 hover:text-white/70 transition">
                      open →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={8} className="text-center text-white/40 py-8">No leads match the current filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[10.5px] text-white/40 leading-relaxed">
        <strong>Age badges:</strong> <span className="text-emerald-300">green</span> under 7 days · <span className="text-amber-300">amber</span> 7–14 days · <span className="text-rose-300">rose</span> over 14 days or never generated. Hover any badge for the exact timestamp. Click a column header to sort. Refresh action uses the checkboxes at the top — set them once, then per-row or bulk select.
      </div>
    </div>
  );
}
