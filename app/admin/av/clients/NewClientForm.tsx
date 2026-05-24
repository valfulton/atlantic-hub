'use client';

/**
 * NewClientForm — operator creates a client in one shot. Collapsed by default so
 * the roster stays clean; expand to fill a few fields. On success it shows the
 * magic link to copy/send and a link straight into the new client's detail.
 * Posts to /api/admin/av/clients/create.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Tier = 'audit_only' | 'sprint' | 'momentum' | 'scale';

const inputCls = 'w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink';
const labelCls = 'block text-[11px] uppercase tracking-[0.1em] text-muted mb-1';

export default function NewClientForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ clientId: number | null; magicLink: string; emailSent: boolean; lineSeeded: boolean } | null>(null);

  const [f, setF] = useState({
    email: '', name: '', company: '', industry: '',
    tier: 'scale' as Tier, trialDays: '30', sendInvite: true,
    key_message: '', target_audience: ''
  });
  const set = (k: keyof typeof f, v: unknown) => setF((s) => ({ ...s, [k]: v }));

  async function submit() {
    if (!f.email.trim()) { setErr('Email is required.'); return; }
    setBusy(true); setErr(null); setDone(null);
    try {
      const res = await fetch('/api/admin/av/clients/create', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: f.email.trim(), name: f.name.trim() || null, company: f.company.trim() || null,
          industry: f.industry.trim() || null, tier: f.tier,
          trialDays: Number(f.trialDays) || null, sendInvite: f.sendInvite,
          key_message: f.key_message.trim() || undefined, target_audience: f.target_audience.trim() || undefined
        })
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        setDone({ clientId: j.clientId ?? null, magicLink: j.magicLink, emailSent: j.emailSent, lineSeeded: j.lineSeeded });
        router.refresh();
      } else {
        setErr(j.error || 'Could not create the client.');
      }
    } catch {
      setErr('Could not create the client.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDone(null); setErr(null);
    setF({ email: '', name: '', company: '', industry: '', tier: 'scale', trialDays: '30', sendInvite: true, key_message: '', target_audience: '' });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-5 rounded-lg bg-brand/90 hover:bg-brand text-black font-medium text-sm px-4 py-2">
        + New client
      </button>
    );
  }

  return (
    <div className="mb-6 rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-base font-semibold text-ink">New client</div>
        <button onClick={() => { setOpen(false); reset(); }} className="text-muted text-sm hover:text-ink">Close</button>
      </div>

      {done ? (
        <div>
          <p className="text-sm text-ink mb-2">
            Client created{done.lineSeeded ? ' with a seeded narrative line' : ''}. {done.emailSent ? 'Magic-link invite emailed.' : 'Email not sent — copy the link below.'}
          </p>
          <label className={labelCls}>Magic link (valid 24h)</label>
          <div className="flex gap-2">
            <input className={inputCls} readOnly value={done.magicLink} onFocusCapture={(e) => e.currentTarget.select()} />
            <button onClick={() => navigator.clipboard?.writeText(done.magicLink)} className="shrink-0 rounded-lg border border-border bg-black/30 px-3 text-sm text-ink">Copy</button>
          </div>
          <div className="mt-4 flex gap-2">
            {done.clientId && <a href={`/admin/av/clients/${done.clientId}`} className="rounded-lg bg-brand/90 hover:bg-brand text-black font-medium text-sm px-4 py-2">Open client</a>}
            <button onClick={reset} className="rounded-lg border border-border bg-black/30 px-4 py-2 text-sm text-ink">Create another</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Email *</label><input className={inputCls} type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div><label className={labelCls}>Contact name</label><input className={inputCls} value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div><label className={labelCls}>Company</label><input className={inputCls} value={f.company} onChange={(e) => set('company', e.target.value)} /></div>
            <div><label className={labelCls}>Industry</label><input className={inputCls} value={f.industry} onChange={(e) => set('industry', e.target.value)} /></div>
            <div>
              <label className={labelCls}>Tier</label>
              <select className={inputCls} value={f.tier} onChange={(e) => set('tier', e.target.value as Tier)}>
                {(['audit_only', 'sprint', 'momentum', 'scale'] as Tier[]).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Trial days (blank = permanent)</label><input className={inputCls} inputMode="numeric" value={f.trialDays} onChange={(e) => set('trialDays', e.target.value)} /></div>
          </div>
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Key message (seeds their line&apos;s thesis)</label><input className={inputCls} value={f.key_message} onChange={(e) => set('key_message', e.target.value)} placeholder="If they remember one thing…" /></div>
            <div><label className={labelCls}>Target audience</label><input className={inputCls} value={f.target_audience} onChange={(e) => set('target_audience', e.target.value)} placeholder="Who they want to reach" /></div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={f.sendInvite} onChange={(e) => set('sendInvite', e.target.checked)} />
            Email the magic-link invite now
          </label>
          {err && <div className="mt-3 text-sm" style={{ color: '#fca5a5' }}>{err}</div>}
          <button onClick={submit} disabled={busy || !f.email.trim()} className="mt-4 rounded-lg bg-brand/90 hover:bg-brand disabled:opacity-50 text-black font-medium text-sm px-5 py-2">
            {busy ? 'Creating…' : 'Create client'}
          </button>
          <span className="text-[11px] text-muted ml-3">Creates the account + hub, sets the tier/trial, and seeds a candidate line.</span>
        </div>
      )}
    </div>
  );
}
