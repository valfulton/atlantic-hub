'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Lifecycle status controls. Replaces the simple stage select on the
 * Identity tab with one that understands the extended enum:
 *
 *   new -> contacted -> qualified -> converted   (happy path)
 *                                  -> lost       (dead)
 *                                  -> nurture    (parked w/ wake date)
 *                                  -> not_now    (parked, shorter wake)
 *                                  -> referred   (sent elsewhere)
 *                                  -> case_study (closed-won, reusable)
 *
 * When transitioning to nurture / not_now / referred, prompts for an
 * optional wake date + reason. On case_study, marks the lead as
 * promotable to the reuse library (future ship).
 *
 * Sets the converted flag inside the parent component so it can fire
 * confetti.
 */

type LifecycleStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'converted'
  | 'lost'
  | 'nurture'
  | 'not_now'
  | 'referred'
  | 'case_study';

const STAGE_OPTIONS: Array<{ value: LifecycleStatus; label: string; group: 'live' | 'park' | 'terminal' }> = [
  { value: 'new', label: 'New', group: 'live' },
  { value: 'contacted', label: 'Contacted', group: 'live' },
  { value: 'qualified', label: 'Qualified', group: 'live' },
  { value: 'nurture', label: 'Nurture (long park)', group: 'park' },
  { value: 'not_now', label: 'Not now (short park)', group: 'park' },
  { value: 'referred', label: 'Referred elsewhere', group: 'park' },
  { value: 'converted', label: 'Converted (closed won)', group: 'terminal' },
  { value: 'case_study', label: 'Case study (closed + reusable)', group: 'terminal' },
  { value: 'lost', label: 'Lost', group: 'terminal' }
];

const PARKED: LifecycleStatus[] = ['nurture', 'not_now', 'referred'];

function defaultWakeDate(s: LifecycleStatus): string {
  const days = s === 'nurture' ? 30 : s === 'not_now' ? 14 : 7;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface Props {
  auditId: string;
  currentStatus: LifecycleStatus;
  currentWakeAtDate?: string | null;
  currentParkedReason?: string | null;
  onConverted?: (companyName: string | undefined) => void;
  companyName?: string;
}

export function LifecycleControls({
  auditId,
  currentStatus,
  currentWakeAtDate,
  currentParkedReason,
  onConverted,
  companyName
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<LifecycleStatus | null>(null);
  const [wakeAt, setWakeAt] = useState<string>(currentWakeAtDate ? currentWakeAtDate.slice(0, 10) : '');
  const [reason, setReason] = useState<string>(currentParkedReason ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function pickStatus(s: LifecycleStatus) {
    if (s === currentStatus) {
      setPending(null);
      return;
    }
    setErr(null);
    if (PARKED.includes(s)) {
      setPending(s);
      if (!wakeAt) setWakeAt(defaultWakeDate(s));
    } else {
      setPending(s);
    }
  }

  async function confirm() {
    if (!pending || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { toStatus: pending };
      if (PARKED.includes(pending)) {
        if (wakeAt) body.wakeAtDate = wakeAt;
        if (reason.trim()) body.parkedReason = reason.trim().slice(0, 160);
      }
      const res = await fetch(`/api/admin/av/leads/${auditId}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || `HTTP ${res.status}`);
        return;
      }
      if (pending === 'converted' && onConverted) onConverted(companyName);
      setPending(null);
      router.refresh();
    } catch (e) {
      setErr(`Network error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setPending(null);
    setErr(null);
  }

  return (
    <div>
      <div className="field-label mb-2">Lifecycle</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {STAGE_OPTIONS.map((opt) => {
          const active = currentStatus === opt.value;
          const isPending = pending === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => pickStatus(opt.value)}
              disabled={busy}
              className={[
                'text-xs px-2.5 py-1 rounded-full border transition-colors',
                active
                  ? 'bg-brand/20 border-brand text-ink'
                  : isPending
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-200'
                  : 'bg-surface border-border text-muted hover:border-brand/50 hover:text-ink'
              ].join(' ')}
            >
              {active ? 'on - ' : isPending ? 'set - ' : ''}{opt.label}
            </button>
          );
        })}
      </div>

      {pending && PARKED.includes(pending) && (
        <div className="bg-surface border border-border rounded-lg p-3 mb-2 space-y-2">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted mb-1">
              Wake date
            </label>
            <input
              type="date"
              value={wakeAt}
              onChange={(e) => setWakeAt(e.target.value)}
              className="px-3 py-1.5 rounded-md border border-border bg-surface text-ink text-sm"
            />
            <span className="text-[11px] text-muted ml-2">cron wakes them this date</span>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted mb-1">
              Reason (optional)
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. waiting on Q4 budget"
              maxLength={160}
              className="w-full px-3 py-1.5 rounded-md border border-border bg-surface text-ink text-sm"
            />
          </div>
        </div>
      )}

      {pending && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="px-3 py-1.5 bg-brand text-black text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Saving...' : `Confirm "${STAGE_OPTIONS.find((o) => o.value === pending)?.label}"`}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="px-3 py-1.5 border border-border text-muted text-sm rounded-md hover:text-ink"
          >
            Cancel
          </button>
          {err && <span className="text-xs text-rose-300" aria-live="polite">{err}</span>}
        </div>
      )}
    </div>
  );
}
