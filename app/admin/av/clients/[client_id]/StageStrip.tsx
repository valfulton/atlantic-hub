/**
 * StageStrip  (#347, val 2026-06-02)
 *
 * 13-chip horizontal onboarding indicator at the top of /admin/av/clients/[id].
 * Each chip lights green when its stage completes, amber while in progress,
 * dim when not started. Clickable chips scroll to the corresponding panel on
 * the page (via anchor id).
 *
 * Server component — the status object is computed in the page and passed in.
 * No client-side data fetching here; mirrors what's actually in the DB right now.
 *
 * Two-row layout (7 + 7 = 14) so chips don't crush at narrow widths.
 * (#381, 2026-06-16) Was 7+6 for 13 chips with Demo spanning two columns.
 * Adding the PR inbox chip brings us to 14, which fits 7+7 perfectly with
 * Demo at single width.
 * The "Demo ready" chip reads differently from the others (gold-tone done).
 */
import type { StageState, OnboardingStatus } from '@/lib/av/onboarding_status';

function chipClassesFor(status: StageState['status'], isDemo = false): string {
  if (status === 'done') {
    return isDemo
      ? 'border border-brand/50 bg-brand/[0.12] text-brand'
      : 'border border-emerald-400/40 bg-emerald-400/[0.08] text-emerald-300';
  }
  if (status === 'inProgress') {
    return 'border border-brand/40 bg-brand/[0.08] text-brand';
  }
  return 'border border-border/60 bg-black/20 text-muted';
}

function StageChip({ stage }: { stage: StageState }) {
  const isDemo = stage.key === 'demo_ready';
  const cls = chipClassesFor(stage.status, isDemo);
  const dotCls = stage.status === 'done'
    ? (isDemo ? 'bg-brand' : 'bg-emerald-400')
    : stage.status === 'inProgress'
      ? 'bg-brand'
      : 'bg-muted/40';

  const content = (
    <div className={`flex flex-col gap-0.5 rounded-md px-2.5 py-2 transition-colors hover:bg-white/[0.03] ${cls}`}>
      <div className="flex items-center gap-1.5">
        <span aria-hidden className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${dotCls}`} />
        <span className="text-[10px] uppercase tracking-[0.14em]">{stage.id}</span>
      </div>
      <div className="text-[11.5px] font-medium leading-tight">{stage.label}</div>
      {stage.detail && (
        <div className="text-[10px] leading-tight">{stage.detail}</div>
      )}
    </div>
  );

  if (stage.anchor) {
    return (
      <a
        href={`#${stage.anchor}`}
        className="block"
        title={stage.label}
      >
        {content}
      </a>
    );
  }
  return <div>{content}</div>;
}

export default function StageStrip({ status }: { status: OnboardingStatus }) {
  const { stages, doneCount, totalCount, demoReady } = status;

  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3.5 mb-5">
      <div className="flex items-baseline justify-between gap-3 mb-2.5 flex-wrap">
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Onboarding</div>
        <div className="text-[11px] text-muted">
          <span className={demoReady ? 'text-brand font-medium' : 'text-emerald-300 font-medium'}>
            {doneCount} of {totalCount}
          </span>
          {demoReady ? ' · demo ready' : ' · keep going'}
        </div>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-2">
        {stages.map((s) => (
          <StageChip key={s.key} stage={s} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted mt-3 pt-2 border-t border-border/60">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Done
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-brand" /> In progress / needs you
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-muted/40" /> Not started
        </span>
        <span className="ml-auto hidden sm:inline">Click a chip to jump to its panel</span>
      </div>
    </div>
  );
}
