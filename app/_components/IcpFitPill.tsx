/**
 * IcpFitPill  (#95)
 *
 * Tiny, reusable score pill that surfaces a lead's "how well does this match
 * the owning client's ICP" score. Used on both /client/leads (client-facing)
 * and the operator mirror at /admin/av/clients/[id]/preview/leads, plus the
 * operator client-page lead list.
 *
 * Renders nothing when the score is null (i.e. unscored). That way an
 * unscored pipeline stays clean -- val sees the pill only after she runs
 * the scorer.
 *
 * Server component: no client interactivity, just renders a span. Pass
 * `reasoning` to render an HTML title attribute (tooltip on hover).
 */

const BANDS: Array<{
  min: number;
  bg: string;
  fg: string;
  label: string;
}> = [
  { min: 85, bg: 'rgba(16,185,129,0.18)',  fg: '#6ee7b7', label: 'Strong fit' },
  { min: 65, bg: 'rgba(245,158,11,0.18)',  fg: '#fcd34d', label: 'Good fit' },
  { min: 40, bg: 'rgba(91,168,255,0.18)',  fg: '#a8cbff', label: 'Weak fit' },
  { min: 0,  bg: 'rgba(255,90,110,0.18)',  fg: '#FF9AA8', label: 'Poor fit' }
];

function bandFor(score: number): { bg: string; fg: string; label: string } {
  return BANDS.find((b) => score >= b.min) ?? BANDS[BANDS.length - 1];
}

export default function IcpFitPill({
  score,
  reasoning,
  size = 'sm'
}: {
  score: number | null;
  reasoning?: string | null;
  size?: 'xs' | 'sm';
}) {
  if (score == null) return null;
  const band = bandFor(score);
  const padClass = size === 'xs' ? 'px-1.5 py-0' : 'px-2 py-0.5';
  const textSize = size === 'xs' ? 'text-[9.5px]' : 'text-[10px]';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ${padClass} ${textSize} uppercase tracking-[0.14em] font-medium`}
      style={{ background: band.bg, color: band.fg }}
      title={reasoning || `${band.label} (${score}/100 vs this client's ICP)`}
    >
      <span className="font-semibold tabular-nums">{score}</span>
      <span className="opacity-80">{band.label}</span>
    </span>
  );
}
