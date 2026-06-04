'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * AuditStalePill  (#90 / #319)
 *
 * Subtle indicator that surfaces when a lead's audit was generated BEFORE
 * the owning client's brief was last edited. Shown on both /client/leads
 * (so the client knows their audit hasn't caught up) and the operator
 * mirror at /admin/av/clients/[id]/preview/leads.
 *
 * Renders NOTHING when the audit is current — keeps the lead list clean.
 *
 * **Operator-side behavior (#319):** when `actionable=true` AND `auditId` is
 * provided, the pill becomes a CLICKABLE button. One click POSTs the lead's
 * audit_id to /api/admin/av/leads/refresh-intel with {audits:true,
 * callScripts:true} so val can fix the staleness inline without scrolling to
 * RefreshIntelPanel. Shows "Refreshing…" while in-flight, "Refreshed ✓"
 * briefly on success, then refreshes the page so the new audit content
 * renders. Falls back to a non-interactive pill with the tooltip pointing at
 * RefreshIntelPanel if no auditId is passed (legacy mount points).
 *
 * Client side (`actionable=false`) is unchanged: just a soft "being
 * refreshed" indicator — no inline action, no button.
 */
export default function AuditStalePill({
  stale,
  size = 'sm',
  actionable = false,
  auditId
}: {
  stale: boolean;
  size?: 'xs' | 'sm';
  actionable?: boolean;
  /** When provided AND actionable, the pill becomes a one-click inline refresh. */
  auditId?: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!stale) return null;

  const padClass = size === 'xs' ? 'px-1.5 py-0' : 'px-2 py-0.5';
  const textSize = size === 'xs' ? 'text-[9.5px]' : 'text-[10px]';

  // Inline-actionable path (operator only — actionable + auditId present).
  // Becomes a real <button>; one click refreshes JUST this lead's audit.
  const canAct = actionable && typeof auditId === 'string' && auditId.length > 0;

  async function runRefresh(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!canAct || state === 'running') return;
    setState('running');
    setErrorMessage(null);
    try {
      const res = await fetch('/api/admin/av/leads/refresh-intel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          auditIds: [auditId],
          audits: true,
          callScripts: true
        })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || j.message || `HTTP ${res.status}`);
      }
      setState('done');
      // Pull fresh server data so the new audit content renders and the pill
      // disappears (audit_generated is now newer than the brief).
      router.refresh();
      // Briefly hold the "done" state so val sees the success blip before the
      // pill vanishes on the refresh.
      setTimeout(() => setState('idle'), 1500);
    } catch (err) {
      setState('error');
      setErrorMessage((err as Error).message);
      setTimeout(() => setState('idle'), 4000);
    }
  }

  const label =
    state === 'running'
      ? 'Refreshing…'
      : state === 'done'
      ? 'Refreshed ✓'
      : state === 'error'
      ? 'Refresh failed'
      : 'Audit out of date';

  const tooltipIdle = canAct
    ? 'The brief was edited after this audit ran. Click to refresh this lead now.'
    : actionable
    ? 'The brief was edited after this audit ran. Click "Refresh AI intel" on the client page to regenerate.'
    : 'The brief was edited after this audit ran.';

  const baseStyle: React.CSSProperties = {
    background: 'rgba(245,158,11,0.12)',
    color: '#fcd34d',
    borderColor: 'rgba(245,158,11,0.35)'
  };

  const runningStyle: React.CSSProperties = {
    ...baseStyle,
    background: 'rgba(245,158,11,0.18)',
    color: '#fde68a'
  };

  const doneStyle: React.CSSProperties = {
    background: 'rgba(16,185,129,0.14)',
    color: '#86efac',
    borderColor: 'rgba(16,185,129,0.4)'
  };

  const errorStyle: React.CSSProperties = {
    background: 'rgba(248,113,113,0.14)',
    color: '#fecaca',
    borderColor: 'rgba(248,113,113,0.45)'
  };

  const style =
    state === 'done' ? doneStyle : state === 'error' ? errorStyle : state === 'running' ? runningStyle : baseStyle;

  const classes = `inline-flex items-center gap-1 rounded-full ${padClass} ${textSize} uppercase tracking-[0.14em] font-medium border`;

  if (canAct) {
    return (
      <button
        type="button"
        onClick={runRefresh}
        disabled={state === 'running'}
        className={`${classes} hover:opacity-90 disabled:cursor-wait cursor-pointer transition`}
        style={style}
        title={state === 'error' ? errorMessage || 'Refresh failed' : tooltipIdle}
      >
        <span aria-hidden="true">
          {state === 'running' ? '⏳' : state === 'done' ? '✓' : state === 'error' ? '!' : '⏳'}
        </span>
        {label}
      </button>
    );
  }

  // Non-actionable (client-side or operator without auditId): plain pill.
  return (
    <span className={classes} style={baseStyle} title={tooltipIdle}>
      <span aria-hidden="true">&#9203;</span>
      Audit out of date
    </span>
  );
}
