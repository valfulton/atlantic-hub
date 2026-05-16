'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STREAMS = [
  ['charter_commission', 'Charter commission'],
  ['vessel_membership', 'Vessel membership'],
  ['event_planner_subscription', 'Event planner subscription'],
  ['corporate_retreat', 'Corporate retreat'],
  ['vendor_network', 'Vendor network'],
  ['atlantic_vine_services', 'Atlantic & Vine services'],
  ['jet_charter', 'Jet charter'],
  ['merchandise', 'Merchandise'],
  ['investor_capital', 'Investor capital'],
  ['other', 'Other']
] as const;

export function AddRevenueForm() {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ entryDate: today, stream: 'charter_commission', amount: '', source: '', notes: '' });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/ebw/revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: Number(form.amount) })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setForm({ entryDate: today, stream: 'charter_commission', amount: '', source: '', notes: '' });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:opacity-90">
        + Log revenue
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="bg-surface border border-border rounded-lg p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted mb-1">Date*</div>
          <input type="date" required value={form.entryDate} onChange={(e) => setForm({ ...form, entryDate: e.target.value })} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted mb-1">Stream*</div>
          <select required value={form.stream} onChange={(e) => setForm({ ...form, stream: e.target.value })} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white">
            {STREAMS.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
          </select>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted mb-1">Amount ($)*</div>
          <input type="number" step="0.01" min="0" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white" />
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-muted mb-1">Source (customer / partner)</div>
        <input type="text" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white" />
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-muted mb-1">Notes</div>
        <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full border border-border rounded-md px-3 py-2 text-sm bg-white" />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-muted hover:text-ink">Cancel</button>
        {error && <span className="text-xs text-red-600">Error: {error}</span>}
      </div>
    </form>
  );
}
