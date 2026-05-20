/**
 * components/ScoreSparkline.tsx
 *
 * Tiny inline SVG sparkline showing how a lead's combined score has
 * moved over the last N score events. Reads the score_history JSON
 * column populated by lib/ai/engagement_score.ts.
 *
 * Pure SVG -- no chart library dep. Designed to render at 120x32 by
 * default but accepts any size. Renders nothing if there is less than
 * two data points (a single point is not a trend).
 */

interface HistoryPoint {
  at: string;
  combined: number;
}

interface Props {
  history: HistoryPoint[] | null | undefined;
  width?: number;
  height?: number;
}

export function ScoreSparkline({ history, width = 120, height = 32 }: Props) {
  if (!history || history.length < 2) return null;

  // score_history is most-recent-first in the DB. Render oldest-first so
  // the line reads left-to-right as time advances.
  const points = [...history].reverse().map((h) => ({
    at: h.at,
    combined: Math.max(0, Math.min(100, h.combined ?? 0))
  }));

  const padX = 2;
  const padY = 3;
  const usableW = width - padX * 2;
  const usableH = height - padY * 2;

  const xs = points.map((_, i) => padX + (i / (points.length - 1)) * usableW);
  const ys = points.map((p) => padY + (1 - p.combined / 100) * usableH);

  const linePath = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${xs[xs.length - 1].toFixed(1)} ${(padY + usableH).toFixed(1)} L ${xs[0].toFixed(1)} ${(padY + usableH).toFixed(1)} Z`;

  const first = points[0].combined;
  const last = points[points.length - 1].combined;
  const delta = last - first;
  const trendColor = delta > 0 ? 'var(--ok)' : delta < 0 ? 'var(--danger)' : 'var(--muted)';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Score moved from ${first} to ${last} across ${points.length} signals`}
    >
      <path d={areaPath} fill={trendColor} opacity={0.12} />
      <path d={linePath} stroke={trendColor} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={2.5} fill={trendColor} stroke="#0a0f1a" strokeWidth={1} />
    </svg>
  );
}
