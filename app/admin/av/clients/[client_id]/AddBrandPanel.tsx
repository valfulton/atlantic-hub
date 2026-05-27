'use client';

/**
 * AddBrandPanel — give this owner ANOTHER brand under the SAME login (#101).
 * Creates a new brand hub, attaches the existing login as owner, and seeds a
 * brief. The owner then sees both brands from one login (brand switcher, 1c).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AddBrandPanel({
  clientId,
  ownerName
}: {
  clientId: number;
  ownerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; href?: string } | null>(null);

  async function addBrand() {
    if (!name.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/add-brand`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), industry: industry.trim() || undefined })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j?.error || 'Could not add the brand.');
      setMsg({ ok: true, text: `Added "${name.trim()}" under ${ownerName}.`, href: `/admin/av/clients/${j.clientId}` });
      setName(''); setIndustry('');
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
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Another business?</div>
            <div className="text-sm text-ink mt-0.5">Add a second brand under {ownerName}&apos;s same login — one account, separate brands.</div>
          </div>
          <button onClick={() => setOpen(true)} className="shrink-0 rounded-lg border border-border bg-black/30 hover:bg-white/5 text-ink font-medium text-sm px-4 py-2">
            Add a brand
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-sm font-semibold text-ink">Add a brand under {ownerName}</div>
        <button onClick={() => { setOpen(false); setMsg(null); }} className="text-muted text-sm hover:text-ink">Close</button>
      </div>
      <p className="text-xs text-muted mb-3">
        Creates a separate brand hub (its own brief, ICP, narrative lines, calendar) owned by this same login.
        They&apos;ll switch between brands from one account — no second password.
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] uppercase tracking-[0.1em] text-muted mb-1">Brand / company name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Candelaria's LDA Services"
            className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink placeholder-muted/60 focus:outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-[0.1em] text-muted mb-1">Industry</label>
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="e.g., Legal Document Assistant"
            className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink placeholder-muted/60 focus:outline-none focus:border-brand"
          />
        </div>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={addBrand}
          disabled={busy || !name.trim()}
          className={
            'rounded-lg px-4 py-2 text-sm font-medium transition ' +
            (busy || !name.trim() ? 'bg-surface-2 text-muted cursor-not-allowed' : 'bg-brand text-brand-fg hover:opacity-90')
          }
        >
          {busy ? 'Adding…' : 'Add brand'}
        </button>
        {msg && (
          <span className={'text-xs ' + (msg.ok ? 'text-emerald-300' : 'text-rose-300')}>
            {msg.text}{' '}
            {msg.href && <a href={msg.href} className="underline hover:text-ink">Open it →</a>}
          </span>
        )}
      </div>
    </div>
  );
}
