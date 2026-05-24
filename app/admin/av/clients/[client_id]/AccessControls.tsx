'use client';

/**
 * AccessControls — operator panel to set a client's tier and access window.
 * Grant a full-package trial, extend it, make it permanent, or revoke (disable).
 * Talks to /api/admin/av/clients/[id]/access.
 */
import { useState } from 'react';

type Tier = 'audit_only' | 'sprint' | 'momentum' | 'scale';
interface State { enabled: boolean; accessUntil: string | null; active: boolean; expired: boolean; planTier: string | null; }

const TIERS: Tier[] = ['audit_only', 'sprint', 'momentum', 'scale'];

const btn: React.CSSProperties = { background: 'rgba(148,163,184,0.12)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)', color: '#1a1207', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' };
const sel: React.CSSProperties = { background: 'rgba(2,6,23,0.6)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 8, padding: '6px 8px', color: '#e2e8f0', fontSize: 12 };

export default function AccessControls({ clientId, initialState, currentTier }: { clientId: number; initialState: State; currentTier: Tier }) {
  const [state, setState] = useState<State>(initialState);
  const [tier, setTier] = useState<Tier>(currentTier);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send(body: Record<string, unknown>, note: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/access`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      const j = await res.json();
      if (res.ok && j.state) { setState(j.state); setMsg(note); }
      else setMsg(j.error || 'Could not update.');
    } catch { setMsg('Could not update.'); }
    finally { setBusy(false); }
  }

  const statusColor = state.active ? '#6ee7b7' : '#fca5a5';
  const statusLabel = state.active ? 'Active' : (state.expired ? 'Trial lapsed' : 'Disabled');

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-6">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-3">Access &amp; tier (operator)</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 12, fontSize: 13 }}>
        <span style={{ color: statusColor, fontWeight: 600 }}>● {statusLabel}</span>
        <span style={{ color: '#94a3b8' }}>
          {state.accessUntil ? `Access until ${state.accessUntil}` : 'No expiry (permanent)'}
        </span>
        <span style={{ color: '#64748b' }}>Plan: {state.planTier ?? '—'}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'end', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 3 }}>Tier</label>
          <select style={sel} value={tier} onChange={(e) => setTier(e.target.value as Tier)} disabled={busy}>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button style={btn} disabled={busy} onClick={() => send({ tier }, `Tier set to ${tier}.`)}>Set tier</button>
        <button style={btnPrimary} disabled={busy} onClick={() => send({ tier: 'scale', grantDays: 30 }, 'Granted a 30-day full-package trial.')}>Grant 30-day full trial</button>
        <button style={btn} disabled={busy} onClick={() => send({ grantDays: 30 }, 'Extended 30 days.')}>Extend +30 days</button>
        <button style={btn} disabled={busy} onClick={() => send({ accessUntil: null }, 'Made permanent (no expiry).')}>Make permanent</button>
        {state.enabled
          ? <button style={{ ...btn, color: '#fca5a5' }} disabled={busy} onClick={() => send({ enabled: false }, 'Access revoked.')}>Disable / revoke</button>
          : <button style={btn} disabled={busy} onClick={() => send({ enabled: true }, 'Access restored.')}>Enable</button>}
      </div>
      {busy && <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>Saving…</div>}
      {msg && !busy && <div style={{ fontSize: 12, color: '#bfdbfe', marginTop: 8 }}>{msg}</div>}
    </div>
  );
}
