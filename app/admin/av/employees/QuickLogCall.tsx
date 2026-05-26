'use client';

/**
 * QuickLogCall — log a call without leaving the rep cockpit.
 *
 * Reuses the existing endpoint POST /api/admin/av/leads/[auditId]/calls (same one
 * the lead-detail Calls tab uses), which appends to call_log, fires an engagement
 * event, and bumps last_activity_at. On success we router.refresh() so the
 * cockpit's weekly calls, streak, and leaderboard recompute on the server.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const OUTCOMES: Array<{ value: string; label: string }> = [
  { value: 'connected', label: 'Connected' },
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'follow_up', label: 'Wants follow-up' },
  { value: 'meeting_booked', label: 'Meeting booked' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'converted', label: 'Closed-won' },
  { value: 'wrong_number', label: 'Wrong number' },
  { value: 'other', label: 'Other' }
];

export function QuickLogCall({ auditId }: { auditId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('connected');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, notes: note.trim() || null })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDone(true);
      setNote('');
      setOpen(false);
      router.refresh();
      setTimeout(() => setDone(false), 2500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] px-2 py-1 rounded-md border border-border text-ink hover:border-brand"
      >
        {done ? '✓ Logged' : '＋ Log call'}
      </button>
    );
  }

  return (
    <div className="w-full mt-1 rounded-lg border border-border bg-black/20 p-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="rounded-md border border-border bg-[#1a1f2e] text-ink text-xs px-2 py-1 focus:outline-none focus:border-brand"
        >
          {OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Quick note (optional)"
          maxLength={400}
          className="flex-1 min-w-[140px] rounded-md border border-border bg-[#1a1f2e] text-ink text-xs px-2 py-1 placeholder:text-slate-500 focus:outline-none focus:border-brand"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="text-[11px] px-3 py-1 rounded-md text-[#1a1207] font-medium disabled:opacity-50"
          style={{ background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)' }}
        >
          {busy ? 'Saving…' : 'Save call'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setErr(null); }}
          className="text-[11px] px-2 py-1 rounded-md border border-border text-muted hover:text-ink"
        >
          Cancel
        </button>
        {err && <span className="text-[11px] text-rose-300">Error: {err}</span>}
      </div>
    </div>
  );
}
