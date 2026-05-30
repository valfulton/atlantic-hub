'use client';

/**
 * ClientPipelineList — the client's pipeline on the operator page, with a per-row
 * Delete so val can clear a stray / mis-assigned lead right here (no DB, no
 * navigating to the lead). Delete archives the lead (soft-delete) via the
 * client-scoped archive endpoint, then drops it from the list.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface PipelineLead {
  id: number;
  auditId: string | null;
  company: string;
  industry: string | null;
  contactName: string | null;
  score: number | null;
  band: string | null;
}

export default function ClientPipelineList({ clientId, leads }: { clientId: number; leads: PipelineLead[] }) {
  const router = useRouter();
  const [list, setList] = useState<PipelineLead[]>(leads);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
      setConfirmId(null);
      router.refresh();
    } catch {
      setErr('Could not delete.');
    } finally {
      setBusyId(null);
    }
  }

  if (list.length === 0) return <p className="text-sm text-muted">No leads yet.</p>;

  return (
    <ul className="divide-y divide-border">
      {list.map((l) => (
        <li key={l.id} className="py-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            {l.auditId ? (
              <Link href={`/admin/av/lead/${l.auditId}`} className="text-sm text-ink truncate hover:text-brand hover:underline">
                {l.company}
              </Link>
            ) : (
              <div className="text-sm text-ink truncate">{l.company}</div>
            )}
            <div className="text-[11px] text-muted">{l.industry || '—'}{l.contactName ? ` · ${l.contactName}` : ''}</div>
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
      ))}
      {err && <li className="py-2 text-[11px]" style={{ color: '#fca5a5' }}>{err}</li>}
    </ul>
  );
}
