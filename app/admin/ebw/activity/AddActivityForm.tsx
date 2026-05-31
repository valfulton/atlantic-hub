'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const TYPES = [
  ['cold_call', 'Cold call'], ['cold_email', 'Cold email'], ['dm', 'DM'],
  ['meeting', 'Meeting'], ['demo', 'Demo'], ['follow_up', 'Follow-up'],
  ['proposal_sent', 'Proposal sent'], ['contract_sent', 'Contract sent'], ['other', 'Other']
] as const;
const OUTCOMES = [
  ['', '—'], ['no_answer', 'No answer'], ['left_voicemail', 'Left voicemail'],
  ['interested', 'Interested'], ['not_interested', 'Not interested'],
  ['meeting_scheduled', 'Meeting scheduled'], ['closed', 'Closed'], ['other', 'Other']
] as const;

export function AddActivityForm() {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ occurredOn: today, activityType: 'cold_call', prospectLabel: '', outcome: '', notes: '' });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/ebw/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, outcome: form.outcome || undefined })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setForm({ occurredOn: today, activityType: 'cold_call', prospectLabel: '', outcome: '', notes: '' });
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
      <button onClick={() => setOpen(true)} className="px-4 py-2 bg-brand text-black text-sm font-medium rounded-md hover:opacity-90">
        + Log a call / email / meeting
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="bg-surface border border-border rounded-lg p-5 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted mb-1">Date*</div>
          <input type="date" required value={form.occurredOn} onChange={(e) => setForm({ ...form, occurredOn: e.target.value })} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted mb-1">Type*</div>
          <select required value={form.activityType} onChange={(e) => setForm({ ...form, activityType: e.target.value })} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white">
            {TYPES.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
          </select>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted mb-1">Outcome</div>
          <select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white">
            {OUTCOMES.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
          </select>
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-muted mb-1">Prospect (name / company)</div>
        <input type="text" value={form.prospectLabel} onChange={(e) => setForm({ ...form, prospectLabel: e.target.value })} className="w-full border border-border rounded-md px-3 py-1.5 text-sm bg-white" />
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-muted mb-1">Notes</div>
        <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full border border-border rounded-md px-3 py-2 text-sm bg-white" />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="px-4 py-2 bg-brand text-black text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-muted hover:text-ink">Cancel</button>
        {error && <span className="text-xs text-red-600">Error: {error}</span>}
      </div>
    </form>
  );
}
