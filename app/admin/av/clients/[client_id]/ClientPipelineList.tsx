'use client';

/**
 * ClientPipelineList — the client's pipeline on the operator page, with:
 *   - per-row delete (kept for stray cleanup) + bulk action bar (#306):
 *     bulk-delete + bulk-move-to-another-client.
 *   - address shown inline so val can triage by geography without
 *     drilling into each lead.
 *
 * Bulk delete fans out parallel POSTs to /archive-lead. Bulk move uses the
 * new transactional /move-leads endpoint (single UPDATE on the server).
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export interface PipelineLead {
  id: number;
  auditId: string | null;
  company: string;
  industry: string | null;
  contactName: string | null;
  // (#315) POC title (e.g. "Sales Director", "Founder") rendered next to the
  // name so val can see WHO Hunter / Apollo landed on without opening the lead.
  contactTitle: string | null;
  score: number | null;
  band: string | null;
  // (#306) Address — pushed through from getClientAccountDetail.
  addressCity: string | null;
  addressState: string | null;
}

export interface ClientOption {
  clientId: number;
  name: string;
}

export default function ClientPipelineList({
  clientId,
  clientName,
  leads,
  otherClients
}: {
  clientId: number;
  clientName: string;
  leads: PipelineLead[];
  otherClients: ClientOption[];
}) {
  const router = useRouter();
  const [list, setList] = useState<PipelineLead[]>(leads);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // (#306) Bulk state
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<'delete' | 'move' | null>(null);
  const [bulkMsg, setBulkMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [destClientId, setDestClientId] = useState<string>('');
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((l) => {
      const hay = [
        l.company,
        l.industry || '',
        l.contactName || '',
        l.addressCity || '',
        l.addressState || ''
      ].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [filter, list]);

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setBulkMsg(null);
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const visibleIds = visible.map((l) => l.id);
      const allOn = visibleIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allOn) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
    setBulkMsg(null);
  }

  async function del(leadId: number) {
    setBusyId(leadId);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/archive-lead`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leadId })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || 'Could not delete.'); setBusyId(null); return; }
      setList((ls) => ls.filter((l) => l.id !== leadId));
      setSelected((s) => { const n = new Set(s); n.delete(leadId); return n; });
      setConfirmId(null);
      router.refresh();
    } catch {
      setErr('Could not delete.');
    } finally {
      setBusyId(null);
    }
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    setBulkBusy('delete');
    setBulkMsg(null);
    const ids = Array.from(selected);
    try {
      // Parallel archive-lead calls. The endpoint is fast (single UPDATE per
      // call). 30 leads max in the panel, so this is bounded.
      const results = await Promise.allSettled(
        ids.map((leadId) =>
          fetch(`/api/admin/av/clients/${clientId}/archive-lead`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ leadId })
          }).then(async (r) => ({ ok: r.ok, leadId }))
        )
      );
      const succeeded = results
        .filter((r): r is PromiseFulfilledResult<{ ok: boolean; leadId: number }> => r.status === 'fulfilled' && r.value.ok)
        .map((r) => r.value.leadId);
      const failed = ids.length - succeeded.length;

      setList((ls) => ls.filter((l) => !succeeded.includes(l.id)));
      setSelected(new Set());
      setBulkMsg({
        ok: failed === 0,
        text: failed === 0
          ? `Deleted ${succeeded.length} lead${succeeded.length === 1 ? '' : 's'}.`
          : `Deleted ${succeeded.length}, ${failed} failed.`
      });
      router.refresh();
    } catch (e) {
      setBulkMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBulkBusy(null);
    }
  }

  async function bulkMove() {
    if (selected.size === 0) return;
    const destId = Number.parseInt(destClientId, 10);
    if (!Number.isFinite(destId) || destId <= 0) {
      setBulkMsg({ ok: false, text: 'Pick a destination client first.' });
      return;
    }
    setBulkBusy('move');
    setBulkMsg(null);
    try {
      const auditIds = Array.from(selected)
        .map((id) => list.find((l) => l.id === id)?.auditId)
        .filter((s): s is string => typeof s === 'string' && s.length > 0);
      if (auditIds.length === 0) {
        setBulkMsg({ ok: false, text: 'Selected leads have no audit_id (legacy data).' });
        return;
      }
      const res = await fetch(`/api/admin/av/clients/${clientId}/move-leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ auditIds, destClientId: destId })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setBulkMsg({ ok: false, text: j.error || 'Could not move.' });
        return;
      }
      const movedIds = Array.from(selected);
      setList((ls) => ls.filter((l) => !movedIds.includes(l.id)));
      setSelected(new Set());
      setBulkMsg({
        ok: true,
        text: `Moved ${j.moved} lead${j.moved === 1 ? '' : 's'} to ${j.destClientName}.`
      });
      router.refresh();
    } catch (e) {
      setBulkMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBulkBusy(null);
    }
  }

  if (list.length === 0) return <p className="text-sm text-muted">No leads yet.</p>;

  const allVisibleSelected = visible.length > 0 && visible.every((l) => selected.has(l.id));
  const someVisibleSelected = visible.some((l) => selected.has(l.id));
  const selectionCount = selected.size;

  return (
    <div>
      {/* (#306) Filter + bulk action bar. Hides itself when nothing's selected
          to stay calm; expands amber when val has work to bulk-process. */}
      <div className="mb-3 space-y-2">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by company, industry, contact, city, or state…"
          className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink placeholder-muted/60 focus:outline-none focus:border-brand"
        />
        {selectionCount > 0 && (
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--gold-bright)_30%,transparent)] bg-[var(--gold-bright)]/[0.04] p-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[color-mix(in_srgb,var(--gold-bright)_95%,transparent)] font-medium">
              {selectionCount} selected
            </span>
            <span className="text-muted">·</span>
            <button
              type="button"
              onClick={bulkDelete}
              disabled={bulkBusy !== null}
              className="px-2.5 py-1 rounded-md border border-rose-400/40 text-rose-200 hover:bg-rose-400/10 transition disabled:opacity-50"
              title="Delete (archive) the selected leads. Soft delete — recoverable from the audit log."
            >
              {bulkBusy === 'delete' ? 'Deleting…' : `Delete ${selectionCount}`}
            </button>
            <span className="text-muted">·</span>
            <span className="text-muted">Move to</span>
            <select
              value={destClientId}
              onChange={(e) => setDestClientId(e.target.value)}
              disabled={bulkBusy !== null}
              className="rounded-md border border-border bg-black/40 px-2 py-1 text-ink text-xs"
            >
              <option value="">— pick client —</option>
              {otherClients.map((c) => (
                <option key={c.clientId} value={c.clientId}>{c.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={bulkMove}
              disabled={bulkBusy !== null || !destClientId}
              // Contrast rule: bg-brand always text-black.
              className="px-2.5 py-1 rounded-md bg-brand text-black hover:opacity-90 font-medium disabled:opacity-50"
            >
              {bulkBusy === 'move' ? 'Moving…' : `Move ${selectionCount}`}
            </button>
            <button
              type="button"
              onClick={() => { setSelected(new Set()); setBulkMsg(null); }}
              className="ml-auto text-muted hover:text-ink"
            >
              Clear
            </button>
          </div>
        )}
        {bulkMsg && (
          <div
            className="text-xs"
            style={{ color: bulkMsg.ok ? '#6ee7b7' : '#fca5a5' }}
          >
            {bulkMsg.text}
          </div>
        )}
      </div>

      {/* Select-all header */}
      <div className="flex items-center gap-2 px-1 py-1 border-b border-border mb-1">
        <input
          type="checkbox"
          checked={allVisibleSelected}
          ref={(el) => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected; }}
          onChange={toggleAllVisible}
          aria-label="Select all visible leads"
        />
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
          {allVisibleSelected ? 'Deselect all visible' : 'Select all visible'} ({visible.length})
        </span>
      </div>

      <ul className="divide-y divide-border">
        {visible.map((l) => {
          const addr = [l.addressCity, l.addressState].filter(Boolean).join(', ');
          return (
            <li key={l.id} className="py-2 flex items-start gap-3">
              <input
                type="checkbox"
                checked={selected.has(l.id)}
                onChange={() => toggleOne(l.id)}
                className="mt-1 shrink-0"
                aria-label={`Select ${l.company}`}
              />
              <div className="min-w-0 flex-1">
                {l.auditId ? (
                  <Link href={`/admin/av/${l.auditId}`} className="text-sm text-ink truncate hover:text-brand hover:underline">
                    {l.company}
                  </Link>
                ) : (
                  <div className="text-sm text-ink truncate">{l.company}</div>
                )}
                <div className="text-[11px] text-muted truncate">
                  {l.industry || '—'}
                  {l.contactName ? ` · ${l.contactName}` : ''}
                  {l.contactTitle ? ` · ${l.contactTitle}` : ''}
                </div>
                {addr && (
                  <div className="text-[11px] text-muted/80 truncate" title={`Address: ${addr}`}>
                    📍 {addr}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm tabular-nums text-ink">
                  {l.score !== null ? Math.round(l.score) : '—'}
                  {l.band && <span className="text-[10px] uppercase tracking-[0.12em] text-muted ml-2">{l.band}</span>}
                </span>
                {confirmId === l.id ? (
                  <span className="inline-flex items-center gap-2 text-[11px]">
                    <span className="text-muted">Delete?</span>
                    <button onClick={() => del(l.id)} disabled={busyId === l.id} className="font-medium" style={{ color: '#fca5a5' }}>
                      {busyId === l.id ? '…' : 'Yes'}
                    </button>
                    <button onClick={() => setConfirmId(null)} disabled={busyId === l.id} className="text-muted hover:text-ink">No</button>
                  </span>
                ) : (
                  <button
                    onClick={() => { setConfirmId(l.id); setErr(null); }}
                    title="Delete this lead (removes it from their pipeline)"
                    aria-label="Delete lead"
                    className="text-[11px] text-muted/70 hover:text-rose-300 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="py-3 text-sm text-muted">No matches for &ldquo;{filter}&rdquo;.</li>
        )}
        {err && <li className="py-2 text-[11px]" style={{ color: '#fca5a5' }}>{err}</li>}
      </ul>

      {/* clientName used in title context above when we extend to multi-msg */}
      <span className="sr-only">{clientName}</span>
    </div>
  );
}
