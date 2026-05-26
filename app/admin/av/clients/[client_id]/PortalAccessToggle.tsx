'use client';

/**
 * PortalAccessToggle — operator control of the intake gate for one client.
 * Default: "Intake required" (they must submit their intake before the hub
 * unlocks). Flip to "Full access" to grant the whole portal now, bypassing the
 * gate — val's call, anytime.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PortalAccessToggle({ clientId, initialFullAccess }: { clientId: number; initialFullAccess: boolean }) {
  const router = useRouter();
  const [full, setFull] = useState(initialFullAccess);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function set(fullAccess: boolean) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/portal-access`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullAccess })
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        setFull(fullAccess);
        setMsg(fullAccess ? 'Full portal access granted.' : 'Intake required before hub access.');
        router.refresh();
      } else {
        setMsg(j.error || 'Could not update.');
      }
    } catch {
      setMsg('Could not update.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-6">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-2">Portal access (operator)</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: full ? '#6ee7b7' : '#fcd34d', fontWeight: 600 }}>
          {full ? '● Full access — hub unlocked' : '● Intake required — hub locked until they submit it'}
        </span>
        {full ? (
          <button onClick={() => set(false)} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs"
            style={{ background: 'rgba(148,163,184,0.12)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.25)' }}>
            {busy ? 'Saving…' : 'Require intake first'}
          </button>
        ) : (
          <button onClick={() => set(true)} disabled={busy} className="rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{ background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)', color: '#1a1207', border: 'none' }}>
            {busy ? 'Saving…' : 'Grant full access now'}
          </button>
        )}
        {msg && <span style={{ fontSize: 12, color: '#bfdbfe' }}>{msg}</span>}
      </div>
      <p className="text-[11px] text-muted mt-2 leading-relaxed">
        Default for trial accounts is intake-first. Granting full access lets them into the whole portal immediately, without the intake.
      </p>
    </div>
  );
}
