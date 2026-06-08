/**
 * RedFlagRibbon  (#523, val 2026-06-08)
 *
 * Top-of-page banner on /admin/av/clients/[id] when the operator-only Due
 * Diligence panel has red flags on file. Severity-tinted (high = rose,
 * medium = orange, low = amber). Click jumps to the Due Diligence panel.
 *
 * Per val's "no duct tape · intelligence auto-populates everywhere" rule:
 * red flags entered in one panel must surface as a warning across the rest
 * of the operator experience. This is the simplest visible-everywhere piece.
 *
 * Operator-only — never rendered on /preview/* mirrors.
 */
import type { RedFlag } from '@/lib/av/client_dossier';

interface Props {
  redFlags: RedFlag[];
}

const SEV_RANK: Record<RedFlag['severity'], number> = { high: 3, medium: 2, low: 1 };

function topSeverity(flags: RedFlag[]): RedFlag['severity'] {
  let top: RedFlag['severity'] = 'low';
  for (const f of flags) {
    if (SEV_RANK[f.severity] > SEV_RANK[top]) top = f.severity;
  }
  return top;
}

const TINTS: Record<RedFlag['severity'], { wrap: string; pill: string; icon: string }> = {
  high: {
    wrap: 'border-rose-400/50 bg-rose-400/[0.08] text-rose-100',
    pill: 'bg-rose-400/20 border-rose-400/40 text-rose-200',
    icon: 'text-rose-300'
  },
  medium: {
    wrap: 'border-orange-400/40 bg-orange-400/[0.06] text-orange-100',
    pill: 'bg-orange-400/15 border-orange-400/40 text-orange-200',
    icon: 'text-orange-300'
  },
  low: {
    wrap: 'border-amber-400/40 bg-amber-400/[0.05] text-amber-100',
    pill: 'bg-amber-400/15 border-amber-400/40 text-amber-200',
    icon: 'text-amber-300'
  }
};

export default function RedFlagRibbon({ redFlags }: Props) {
  if (!redFlags || redFlags.length === 0) return null;
  const sev = topSeverity(redFlags);
  const tint = TINTS[sev];
  const counts = {
    high: redFlags.filter((f) => f.severity === 'high').length,
    medium: redFlags.filter((f) => f.severity === 'medium').length,
    low: redFlags.filter((f) => f.severity === 'low').length
  };
  // First high-severity flag is the lede; fallback to first overall.
  const lede = redFlags.find((f) => f.severity === 'high')
            ?? redFlags.find((f) => f.severity === 'medium')
            ?? redFlags[0];

  return (
    <a
      href="#dossier"
      className={`block rounded-2xl border ${tint.wrap} px-4 py-3 mb-4 hover:brightness-110 transition`}
    >
      <div className="flex items-start gap-3 flex-wrap">
        <div className={`text-xl leading-none mt-0.5 ${tint.icon}`} aria-hidden>⚠</div>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] uppercase tracking-[0.14em] opacity-80 mb-0.5">
            Due Diligence — {redFlags.length} flag{redFlags.length === 1 ? '' : 's'} on file
          </div>
          <div className="text-[13px] font-medium leading-snug">
            {lede.label}
          </div>
          <div className="text-[11px] opacity-75 mt-1 flex flex-wrap items-center gap-1.5">
            {counts.high > 0 && (
              <span className={`rounded px-1.5 py-0.5 border ${TINTS.high.pill} text-[10px] uppercase tracking-wider`}>
                {counts.high} high
              </span>
            )}
            {counts.medium > 0 && (
              <span className={`rounded px-1.5 py-0.5 border ${TINTS.medium.pill} text-[10px] uppercase tracking-wider`}>
                {counts.medium} medium
              </span>
            )}
            {counts.low > 0 && (
              <span className={`rounded px-1.5 py-0.5 border ${TINTS.low.pill} text-[10px] uppercase tracking-wider`}>
                {counts.low} low
              </span>
            )}
            <span className="opacity-70">· review before invoicing / committing</span>
          </div>
        </div>
        <div className="text-[11px] opacity-70 shrink-0 hidden sm:block">
          tap to open Due Diligence →
        </div>
      </div>
    </a>
  );
}
