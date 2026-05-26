'use client';

/**
 * EnrichClientLeadsButton — operator enriches a client's pipeline leads on their
 * behalf: fills missing contact name + email (via Hunter) for leads scoped to
 * THIS client only. Uses the operator's Hunter credits; respects the monthly cap.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function EnrichClientLeadsButton({ clientId, clientName }: { clientId: number; clientName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/enrich`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 10 })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || j.message || 'Enrichment failed.');
      setMsg({ ok: true, text: j.message || 'Done.' });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-5">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-1">Enrich their leads (on their behalf)</div>
      <p className="text-xs text-muted mb-2 leading-relaxed">
        Fills in missing contact details — name + email — for {clientName}&rsquo;s pipeline leads.
        Uses your monthly enrichment credits and respects the cap.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={run}
          disabled={busy}
          className="rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)', color: '#1a1207', border: 'none' }}
        >
          {busy ? 'Enriching…' : 'Enrich their leads'}
        </button>
        {msg && <span className="text-xs" style={{ color: msg.ok ? '#6ee7b7' : '#fca5a5' }}>{msg.text}</span>}
      </div>
    </div>
  );
}
