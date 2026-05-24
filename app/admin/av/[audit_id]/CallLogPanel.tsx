'use client';
import { useCallback, useEffect, useState } from 'react';
import { fmtDateTime } from '@/lib/format/datetime';

/**
 * Calls tab content for the lead detail page.
 *
 * Lists past call attempts most-recent-first + a tight form to log a
 * new one. POSTs to /api/admin/av/leads/[audit_id]/calls. After a
 * successful log, refreshes the list and calls onCallLogged so the
 * parent can refresh server data (engagement score moves on certain
 * outcomes).
 */

interface CallEntry {
  callLogId: number;
  leadId: number;
  userId: number | null;
  outcome: string;
  durationSeconds: number | null;
  notes: string | null;
  calledAt: string;
}

interface Props {
  auditId: string;
  onCallLogged?: () => void;
}

const OUTCOMES: Array<{ value: string; label: string }> = [
  { value: 'connected', label: 'Connected -- live conversation' },
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'wrong_number', label: 'Wrong number' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'follow_up', label: 'Wants follow-up' },
  { value: 'meeting_booked', label: 'Meeting booked' },
  { value: 'converted', label: 'Closed-won on call' },
  { value: 'other', label: 'Other' }
];

const OUTCOME_STYLES: Record<string, string> = {
  connected: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  voicemail: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  no_answer: 'bg-gray-500/15 text-gray-300 border-gray-500/40',
  wrong_number: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  not_interested: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  follow_up: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  meeting_booked: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  converted: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40',
  other: 'bg-gray-500/15 text-gray-300 border-gray-500/40'
};

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function CallLogPanel({ auditId, onCallLogged }: Props) {
  const [calls, setCalls] = useState<CallEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [outcome, setOutcome] = useState<string>('connected');
  const [durationStr, setDurationStr] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchCalls = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/calls`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || `HTTP ${res.status}`);
        return;
      }
      setCalls(data.calls || []);
    } catch (e) {
      setErr(`Network error: ${(e as Error).message}`);
    } finally {
      setLoaded(true);
    }
  }, [auditId]);

  useEffect(() => {
    void fetchCalls();
  }, [fetchCalls]);

  async function logCall() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const durationSeconds = durationStr ? Math.max(0, Math.min(7200, parseInt(durationStr, 10) || 0)) : null;
      const res = await fetch(`/api/admin/av/leads/${auditId}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome,
          durationSeconds,
          notes: notes.trim() || null
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || `HTTP ${res.status}`);
        return;
      }
      setNotes('');
      setDurationStr('');
      await fetchCalls();
      if (onCallLogged) onCallLogged();
    } catch (e) {
      setErr(`Network error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-surface border border-border rounded-lg p-4">
        <div className="field-label mb-3">Log a call</div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_120px] gap-3 mb-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted mb-1">Outcome</label>
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-border bg-surface text-ink text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {OUTCOMES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted mb-1">Duration (sec)</label>
            <input
              type="number"
              min={0}
              max={7200}
              value={durationStr}
              onChange={(e) => setDurationStr(e.target.value)}
              placeholder="optional"
              className="w-full px-3 py-2 rounded-md border border-border bg-surface text-ink text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
          </div>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What did they say? Next steps? Objections?"
          rows={3}
          maxLength={4000}
          className="w-full px-3 py-2 rounded-md border border-border bg-surface text-ink text-sm mb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={logCall}
            disabled={busy}
            className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Logging...' : 'Log call'}
          </button>
          <span className="text-[11px] text-muted">{notes.length} / 4000</span>
          {err && <span className="text-xs text-rose-300" aria-live="polite">Error: {err}</span>}
        </div>
      </div>

      <div>
        <div className="field-label mb-2">Past calls ({calls.length})</div>
        {!loaded ? (
          <p className="text-sm text-muted">Loading...</p>
        ) : calls.length === 0 ? (
          <p className="text-sm text-muted">No calls logged for this lead yet.</p>
        ) : (
          <ul className="space-y-2">
            {calls.map((c) => (
              <li
                key={c.callLogId}
                className="bg-surface border border-border rounded-lg px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${OUTCOME_STYLES[c.outcome] || OUTCOME_STYLES.other}`}
                    >
                      {c.outcome.replace(/_/g, ' ')}
                    </span>
                    {c.durationSeconds !== null && c.durationSeconds > 0 && (
                      <span className="text-xs text-muted tabular-nums">{formatDuration(c.durationSeconds)}</span>
                    )}
                  </div>
                  <time dateTime={c.calledAt} className="text-xs text-muted">
                    {fmtDateTime(c.calledAt)}
                  </time>
                </div>
                {c.notes && (
                  <p className="text-sm whitespace-pre-wrap text-ink leading-relaxed">{c.notes}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
