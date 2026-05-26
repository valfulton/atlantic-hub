'use client';

/**
 * FindLeadsForClient — operator runs CLIENT-SCOPED discovery for this account.
 * Leads land in the client's own hub (their client_id), never the AV pipeline.
 * Count-controlled (1..25) so val pulls a small, reviewable, one-time batch.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function FindLeadsForClient({ clientId, clientName }: { clientId: number; clientName: string }) {
  const router = useRouter();
  const [limit, setLimit] = useState(10);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tone, setTone] = useState<'ok' | 'info' | 'err'>('info');

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/find-leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit })
      });
      const j = await res.json();
      if (!res.ok) { setTone(j.error === 'icp_incomplete' || j.error === 'cap_reached' ? 'info' : 'err'); setMsg(j.message || j.error || 'Could not find leads.'); return; }
      setTone(j.inserted > 0 ? 'ok' : 'info');
      setMsg(j.message);
      if (j.inserted > 0) router.refresh();
    } catch {
      setTone('err');
      setMsg('Could not find leads.');
    } finally {
      setBusy(false);
    }
  }

  const color = tone === 'ok' ? '#6ee7b7' : tone === 'err' ? '#fca5a5' : '#bfdbfe';

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-2">Find leads for {clientName} (their hub only)</div>
      <p className="text-xs text-muted mb-3 leading-relaxed">
        Runs discovery against <span className="text-ink">their</span> ideal-client profile and stamps every result with their account — nothing touches your AV pipeline. Pick how many to pull; review them in their pipeline below.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: '#94a3b8' }}>
          How many{' '}
          <input
            type="number"
            min={1}
            max={25}
            value={limit}
            onChange={(e) => setLimit(Math.max(1, Math.min(25, Number(e.target.value) || 1)))}
            disabled={busy}
            style={{ width: 64, marginLeft: 6, background: 'rgba(2,6,23,0.6)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 6, color: '#e2e8f0', fontSize: 13, padding: '4px 8px' }}
          />
        </label>
        <button
          onClick={run}
          disabled={busy}
          style={{ background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)', color: '#1a1207', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'Finding…' : `✦ Find ${limit} lead${limit === 1 ? '' : 's'} for this client`}
        </button>
        {msg && <span style={{ fontSize: 12, color }}>{msg}</span>}
      </div>
    </div>
  );
}
