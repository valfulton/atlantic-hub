'use client';

/**
 * AccountInfoEditor — operator edit of a client's account label + primary
 * contact name, right on the client page (no SQL). Fixes the "skipk79 instead of
 * Skip Krause" case and lets val rename/clean up any client account.
 *
 * Saves to /api/admin/av/clients/[id]/account, then refreshes the server
 * component so the new name shows immediately in the header and everywhere else.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const input: React.CSSProperties = {
  background: 'rgba(2,6,23,0.6)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 8,
  padding: '7px 10px', color: '#e2e8f0', fontSize: 13, width: '100%'
};
const btnPrimary: React.CSSProperties = {
  background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)', color: '#1a1207', border: 'none',
  borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer'
};

export default function AccountInfoEditor({
  clientId,
  initialClientName,
  initialIndustry,
  contactEmail,
  initialContactName
}: {
  clientId: number;
  initialClientName: string;
  initialIndustry: string;
  contactEmail: string | null;
  initialContactName: string;
}) {
  const router = useRouter();
  const [clientName, setClientName] = useState(initialClientName);
  const [industry, setIndustry] = useState(initialIndustry);
  const [contactName, setContactName] = useState(initialContactName);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    if (!clientName.trim()) { setMsg('Account name cannot be empty.'); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/account`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientName: clientName.trim(),
          industry: industry.trim(),
          contactName: contactName.trim(),
          memberEmail: contactEmail ?? undefined
        })
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        setMsg('Saved.');
        router.refresh();
      } else {
        setMsg(j.error || 'Could not save.');
      }
    } catch {
      setMsg('Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-brand hover:underline text-sm"
      >
        Edit account info →
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Edit account info (operator)</div>
        <button onClick={() => setOpen(false)} className="text-muted hover:text-ink text-xs">Close</button>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Account name (shown everywhere)</span>
          <input style={input} value={clientName} onChange={(e) => setClientName(e.target.value)} disabled={busy} placeholder="e.g. Skip Krause" />
        </label>
        <label className="block">
          <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Industry</span>
          <input style={input} value={industry} onChange={(e) => setIndustry(e.target.value)} disabled={busy} placeholder="e.g. Health Insurance" />
        </label>
        <label className="block">
          <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
            Contact name {contactEmail ? `(${contactEmail})` : '(no member on account)'}
          </span>
          <input
            style={{ ...input, opacity: contactEmail ? 1 : 0.5 }}
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            disabled={busy || !contactEmail}
            placeholder="The name they see — e.g. Skip Krause"
          />
        </label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <button style={btnPrimary} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save account info'}</button>
        {msg && <span style={{ fontSize: 12, color: msg === 'Saved.' ? '#6ee7b7' : '#bfdbfe' }}>{msg}</span>}
      </div>
    </div>
  );
}
