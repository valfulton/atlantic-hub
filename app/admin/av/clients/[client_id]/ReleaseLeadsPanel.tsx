'use client';

/**
 * ReleaseLeadsPanel — bulk take-back. Lists the leads THIS client currently owns
 * with checkboxes; the operator multi-selects and returns them to the house
 * pipeline in one click. Posts to /api/admin/av/clients/[client_id]/release-leads.
 *
 * Take-back only flips ownership (client_id -> NULL); all enrichment, scores,
 * audits, and notes stay on the lead. The reassuring copy says so.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface OwnedLead {
  auditId: string;
  company: string;
  industry: string | null;
  contactName: string | null;
  score: number | null;
  band: string | null;
}

export default function ReleaseLeadsPanel({
  clientId,
  clientName,
  leads
}: {
  clientId: number;
  clientName: string;
  leads: OwnedLead[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return leads;
    return leads.filter(
      (l) =>
        l.company.toLowerCase().includes(needle) ||
        (l.industry || '').toLowerCase().includes(needle) ||
        (l.contactName || '').toLowerCase().includes(needle)
    );
  }, [q, leads]);

  function toggle(id: string) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
    setMsg(null);
  }

  function selectAll() {
    setSel(new Set(filtered.map((l) => l.auditId)));
    setMsg(null);
  }

  async function release() {
    if (sel.size === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/release-leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ auditIds: Array.from(sel) })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j?.error || 'Could not take back.');
      setMsg({ ok: true, text: `Took back ${j.released} lead${j.released === 1 ? '' : 's'} from ${clientName} to your house pipeline. Enrichment kept.` });
      setSel(new Set());
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4 mb-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Take leads back</div>
            <div className="text-sm text-ink mt-0.5">Return prospects from {clientName} to your house pipeline. Enrichment is kept.</div>
          </div>
          <button onClick={() => setOpen(true)} className="shrink-0 rounded-lg border border-border bg-black/30 hover:bg-white/5 text-ink font-medium text-sm px-4 py-2">
            Take back leads
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-sm font-semibold text-ink">Take leads back from {clientName}</div>
        <button onClick={() => { setOpen(false); setSel(new Set()); }} className="text-muted text-sm hover:text-ink">Close</button>
      </div>

      {leads.length === 0 ? (
        <p className="text-sm text-muted">{clientName} has no leads assigned right now.</p>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by company, industry, or contact…"
              className="flex-1 rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink placeholder-muted/60 focus:outline-none focus:border-brand"
            />
            <button onClick={selectAll} className="shrink-0 rounded-lg border border-border bg-black/30 hover:bg-white/5 text-muted text-xs px-3 py-2">
              Select all
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-border border border-border rounded-lg">
            {filtered.map((l) => (
              <label key={l.auditId} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-white/5">
                <input type="checkbox" checked={sel.has(l.auditId)} onChange={() => toggle(l.auditId)} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink truncate">{l.company}</div>
                  <div className="text-[11px] text-muted truncate">{l.industry || '—'}{l.contactName ? ` · ${l.contactName}` : ''}</div>
                </div>
                <div className="text-xs tabular-nums text-muted shrink-0">
                  {l.score !== null ? Math.round(l.score) : '—'}{l.band ? ` ${l.band}` : ''}
                </div>
              </label>
            ))}
            {filtered.length === 0 && <div className="px-3 py-3 text-sm text-muted">No matches.</div>}
          </div>

          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={release}
              disabled={busy || sel.size === 0}
              className={
                'rounded-lg px-4 py-2 text-sm font-medium transition ' +
                (busy || sel.size === 0 ? 'bg-surface-2 text-muted cursor-not-allowed' : 'bg-brand text-brand-fg hover:opacity-90')
              }
            >
              {busy ? 'Taking back…' : `Take back ${sel.size || ''} ${sel.size === 1 ? 'lead' : 'leads'}`.trim()}
            </button>
            {msg && <span className={'text-xs ' + (msg.ok ? 'text-emerald-300' : 'text-rose-300')}>{msg.text}</span>}
          </div>
        </>
      )}
    </div>
  );
}
