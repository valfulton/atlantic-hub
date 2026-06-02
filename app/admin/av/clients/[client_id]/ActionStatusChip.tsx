/**
 * ActionStatusChip  (#355, val 2026-06-02)
 *
 * Tiny status pill mounted in the header of action cards (BrandKit, FillIntake,
 * FindLeads, etc.) so val can tell at a glance whether the action has already
 * been run for this client and what it produced.
 *
 * Mirrors the green / amber / dim system of the StageStrip. Renders nothing
 * (null) when the status object is undefined — safe to pass from server pages
 * that conditionally load status.
 */
import type { ActionStatus } from '@/lib/av/onboarding_status';

function timeAgo(d: Date | null): string {
  if (!d) return '';
  const ts = typeof d === 'string' ? new Date(d) : d;
  const diff = Date.now() - ts.getTime();
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return ts.toLocaleDateString();
}

export default function ActionStatusChip({
  status,
  notRunLabel = 'Never run'
}: {
  status?: ActionStatus;
  /** Label to show when hasRun=false. Default "Never run". */
  notRunLabel?: string;
}) {
  if (!status) return null;
  if (!status.hasRun) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted">
        <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-muted/40" />
        {notRunLabel}
      </span>
    );
  }
  const when = timeAgo(status.lastAt);
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-emerald-300">
      <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
      {when ? `Ran ${when}` : 'Saved'}
      {status.detail ? <span className="text-emerald-200/80 normal-case tracking-normal lowercase ml-1">· {status.detail}</span> : null}
    </span>
  );
}
