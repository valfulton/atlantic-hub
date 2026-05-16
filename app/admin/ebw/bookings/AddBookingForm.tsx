'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const STATUSES = ['booked', 'deposit_paid', 'completed', 'cancelled', 'refunded'] as const;
const MARKETS = ['St. Croix', 'Miami', 'Annapolis', 'DC/Potomac', 'SF Bay', 'Other'] as const;

export function AddBookingForm() {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    bookedOn: today,
    eventDate: '',
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    market: '',
    groupSize: '',
    eventType: '',
    vesselPartner: '',
    eventPlanner: '',
    grossRevenue: '',
    ebwCommission: '',
    status: 'booked',
    notes: ''
  });

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { ...form };
      // Auto-calc commission as 22% if gross set but commission empty
      if (form.grossRevenue && !form.ebwCommission) {
        payload.ebwCommission = (Number(form.grossRevenue) * 0.22).toFixed(2);
      }
      const res = await fetch('/api/admin/ebw/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setForm({
        bookedOn: today,
        eventDate: '',
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        market: '',
        groupSize: '',
        eventType: '',
        vesselPartner: '',
        eventPlanner: '',
        grossRevenue: '',
        ebwCommission: '',
        status: 'booked',
        notes: ''
      });
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
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:opacity-90"
      >
        + Log a new booking
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="bg-surface border border-border rounded-lg p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Booked on*" required>
          <input type="date" required value={form.bookedOn} onChange={(e) => update('bookedOn', e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white" />
        </Field>
        <Field label="Event date">
          <input type="date" value={form.eventDate} onChange={(e) => update('eventDate', e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white" />
        </Field>
        <Field label="Customer name*" required>
          <input type="text" required value={form.customerName} onChange={(e) => update('customerName', e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white" />
        </Field>
        <Field label="Customer email">
          <input type="email" value={form.customerEmail} onChange={(e) => update('customerEmail', e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white" />
        </Field>
        <Field label="Customer phone">
          <input type="tel" value={form.customerPhone} onChange={(e) => update('customerPhone', e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white" />
        </Field>
        <Field label="Market">
          <select value={form.market} onChange={(e) => update('market', e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white">
            <option value="">—</option>
            {MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Group size">
          <input type="number" min="0" value={form.groupSize} onChange={(e) => update('groupSize', e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white" />
        </Field>
        <Field label="Event type">
          <input type="text" placeholder="wedding · corporate · charter · jet · …" value={form.eventType} onChange={(e) => update('eventType', e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white" />
        </Field>
        <Field label="Vessel partner">
          <input type="text" value={form.vesselPartner} onChange={(e) => update('vesselPartner', e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white" />
        </Field>
        <Field label="Event planner">
          <input type="text" value={form.eventPlanner} onChange={(e) => update('eventPlanner', e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white" />
        </Field>
        <Field label="Gross revenue ($)">
          <input type="number" step="0.01" min="0" value={form.grossRevenue} onChange={(e) => update('grossRevenue', e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white" />
        </Field>
        <Field label="EBW commission ($)" hint="leave blank to auto-calc 22%">
          <input type="number" step="0.01" min="0" value={form.ebwCommission} onChange={(e) => update('ebwCommission', e.target.value)} placeholder={form.grossRevenue ? (Number(form.grossRevenue) * 0.22).toFixed(2) : ''} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white" />
        </Field>
        <Field label="Status">
          <select value={form.status} onChange={(e) => update('status', e.target.value)} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white">
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={3} value={form.notes} onChange={(e) => update('notes', e.target.value)} className="w-full border border-border rounded-md px-3 py-2 text-sm bg-white" />
      </Field>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save booking'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-muted hover:text-ink">
          Cancel
        </button>
        {error && <span className="text-xs text-red-600">Error: {error}</span>}
      </div>
    </form>
  );
}

function Field({ label, hint, children, required }: { label: string; hint?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted mb-1">
        {label}
        {hint && <span className="ml-2 normal-case tracking-normal lowercase text-[10px] opacity-70">— {hint}</span>}
      </div>
      {children}
    </div>
  );
}
