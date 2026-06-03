/**
 * MiniStageStrip  (val 2026-06-02)
 *
 * Compact 13-dot version of the per-client StageStrip, for the cross-client
 * roll-up table on /admin/av/clients. Each dot is one onboarding stage; same
 * green / amber / muted color rule as the full strip.
 *
 * Hover any dot to see its label + detail. The count to the right ("8/13")
 * gives the at-a-glance scan.
 */
import type { StageState } from '@/lib/av/onboarding_status';

function dotClass(status: StageState['status']): string {
  if (status === 'done') return 'bg-emerald-400';
  if (status === 'inProgress') return 'bg-brand';
  return 'bg-muted/35';
}

export default function MiniStageStrip({
  stages,
  doneCount,
  totalCount
}: {
  stages: StageState[];
  doneCount: number;
  totalCount: number;
}) {
  const allDone = doneCount === totalCount;
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-[3px]">
        {stages.map((s) => (
          <span
            key={s.key}
            title={`${s.id}. ${s.label}${s.detail ? ` — ${s.detail}` : ''}`}
            aria-hidden
            className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass(s.status)}`}
          />
        ))}
      </div>
      <span
        className={
          'text-[10.5px] tabular-nums shrink-0 ' +
          (allDone ? 'text-brand font-medium' : doneCount > 0 ? 'text-emerald-300' : 'text-muted')
        }
      >
        {doneCount}/{totalCount}
      </span>
    </div>
  );
}
