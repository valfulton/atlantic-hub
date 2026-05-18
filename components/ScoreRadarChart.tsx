/**
 * components/ScoreRadarChart.tsx
 *
 * Radar / spider chart for the four AI sub-scores. Pure SVG -- no recharts
 * dependency. Renders at the size requested (default 240px square).
 *
 * Axes (clockwise from top): Fit / Intent / Reachability / ICP Match
 * Each axis is 0-100. The polygon shows the actual scores; the dotted ring
 * shows the 50-point reference.
 *
 * Why pure SVG: avoids a ~50KB dep (recharts), no SSR hydration mismatches,
 * trivial to retheme by changing CSS variables.
 */

export interface ScoreBreakdown {
  fit: number;
  intent: number;
  reachability: number;
  icp_match: number;
}

interface Props {
  breakdown: ScoreBreakdown;
  size?: number;
}

const AXES: Array<{ key: keyof ScoreBreakdown; label: string }> = [
  { key: 'fit', label: 'Fit' },
  { key: 'intent', label: 'Intent' },
  { key: 'reachability', label: 'Reach' },
  { key: 'icp_match', label: 'ICP' }
];

function clamp(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function ScoreRadarChart({ breakdown, size = 240 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const padding = 36; // room for axis labels
  const radius = (size - padding * 2) / 2;

  // Top, right, bottom, left -- one axis per cardinal direction.
  const angles = AXES.map((_, i) => -Math.PI / 2 + (i * Math.PI) / 2);

  function pointFor(value: number, angleIdx: number): [number, number] {
    const r = (clamp(value) / 100) * radius;
    return [cx + r * Math.cos(angles[angleIdx]), cy + r * Math.sin(angles[angleIdx])];
  }

  const scorePoints = AXES.map((a, i) => pointFor(breakdown[a.key], i));
  const fullRingPoints = AXES.map((_, i) => pointFor(100, i));
  const halfRingPoints = AXES.map((_, i) => pointFor(50, i));

  const toPathPoints = (pts: Array<[number, number]>) =>
    pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

  return (
    <div className="inline-block" style={{ width: size, height: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label={`AI score breakdown radar: fit ${clamp(breakdown.fit)}, intent ${clamp(
          breakdown.intent
        )}, reachability ${clamp(breakdown.reachability)}, icp ${clamp(breakdown.icp_match)}`}
      >
        {/* Outer ring (100) */}
        <polygon
          points={toPathPoints(fullRingPoints)}
          fill="none"
          stroke="var(--border)"
          strokeWidth={1}
        />
        {/* Half ring (50) -- dashed reference */}
        <polygon
          points={toPathPoints(halfRingPoints)}
          fill="none"
          stroke="var(--border)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.6}
        />
        {/* Axis lines */}
        {AXES.map((a, i) => {
          const [ex, ey] = pointFor(100, i);
          return (
            <line
              key={`axis-${a.key}`}
              x1={cx}
              y1={cy}
              x2={ex}
              y2={ey}
              stroke="var(--border)"
              strokeWidth={1}
              opacity={0.5}
            />
          );
        })}
        {/* Score polygon */}
        <polygon
          points={toPathPoints(scorePoints)}
          fill="var(--brand)"
          fillOpacity={0.22}
          stroke="var(--brand)"
          strokeWidth={1.5}
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            animation: 'radarPop 700ms cubic-bezier(0.34, 1.56, 0.64, 1) both'
          }}
        />
        {/* Score dots */}
        {scorePoints.map(([x, y], i) => (
          <circle
            key={`dot-${i}`}
            cx={x}
            cy={y}
            r={3}
            fill="var(--brand)"
            stroke="#0a0f1a"
            strokeWidth={1.5}
          />
        ))}
        {/* Axis labels */}
        {AXES.map((a, i) => {
          const [lx, ly] = pointFor(118, i); // outside the ring
          const value = clamp(breakdown[a.key]);
          // Adjust text anchor by direction so labels don't overlap the polygon
          const anchor =
            i === 1 ? 'start' : i === 3 ? 'end' : 'middle';
          const dy = i === 0 ? -2 : i === 2 ? 14 : 4;
          return (
            <g key={`label-${a.key}`}>
              <text
                x={lx}
                y={ly + dy}
                textAnchor={anchor}
                className="text-[10px] uppercase tracking-wider"
                fill="var(--muted)"
              >
                {a.label}
              </text>
              <text
                x={lx}
                y={ly + dy + 12}
                textAnchor={anchor}
                className="text-[11px] font-semibold"
                fill="var(--ink)"
              >
                {value}
              </text>
            </g>
          );
        })}
      </svg>
      <style>{`
        @keyframes radarPop {
          0%   { transform: scale(0.25); opacity: 0; }
          60%  { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
