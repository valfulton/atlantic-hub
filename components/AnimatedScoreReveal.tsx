'use client';
/**
 * components/AnimatedScoreReveal.tsx
 *
 * Animated score badge. Counts the number up from 0 -> final over 1.5s
 * whenever the `score` prop changes, then pulses the band badge with a
 * brief brand-color glow. If `breakdown` is provided, renders four small
 * sub-score bars below the score that fill left-to-right over 0.8s.
 *
 * Pure CSS / requestAnimationFrame -- no Framer Motion. The animation
 * re-fires every time the score prop changes (after a Re-score click)
 * because the useEffect is keyed on `score`.
 */

import { useEffect, useRef, useState } from 'react';

export type ScoreBand = 'hot' | 'warm' | 'cool';

interface Breakdown {
  fit: number;
  intent: number;
  reachability: number;
  icp_match: number;
}

interface Props {
  score: number | null;
  band: ScoreBand | null;
  breakdown?: Breakdown | null;
  /** Reveal animation duration in ms. Default 1500. */
  durationMs?: number;
  /** Skip the count-up animation and just snap to the value. */
  static?: boolean;
}

const BAND_STYLES: Record<ScoreBand, { wrap: string; ring: string; pulse: string }> = {
  hot: {
    wrap: 'bg-rose-500/15 text-rose-200 border-rose-500/40',
    ring: 'ring-rose-500/40',
    pulse: 'shadow-[0_0_24px_rgba(244,63,94,0.55)]'
  },
  warm: {
    wrap: 'bg-[#EBCB6B]/12 text-[#EBCB6B]/95 border-[#EBCB6B]/40',
    ring: 'ring-[#EBCB6B]/40',
    pulse: 'shadow-[0_0_24px_rgba(245,158,11,0.55)]'
  },
  cool: {
    wrap: 'bg-sky-500/15 text-sky-200 border-sky-500/40',
    ring: 'ring-sky-500/40',
    pulse: 'shadow-[0_0_18px_rgba(14,165,233,0.45)]'
  }
};

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function AnimatedScoreReveal({
  score,
  band,
  breakdown,
  durationMs = 1500,
  static: isStatic = false
}: Props) {
  const target = score === null ? 0 : clamp(score);
  const [display, setDisplay] = useState<number>(target);
  const [glow, setGlow] = useState(false);
  const rafRef = useRef<number | null>(null);
  // Track the last animated-to value so we only re-animate on real changes,
  // not on initial mount. On first render previousTargetRef is target,
  // so the effect snaps without animating.
  const previousTargetRef = useRef<number>(target);

  // Animate the score count-up ONLY when the target changes after mount.
  // First render snaps to value (no count-up every time you open the page).
  // Subsequent prop changes (e.g. after Re-score triggers router.refresh)
  // animate from the previous value to the new value.
  useEffect(() => {
    if (isStatic || score === null) {
      setDisplay(target);
      previousTargetRef.current = target;
      return;
    }
    const startVal = previousTargetRef.current;
    if (startVal === target) {
      // No real change -- just make sure display matches.
      setDisplay(target);
      return;
    }
    const startTs = performance.now();
    function tick(now: number) {
      const elapsed = now - startTs;
      const t = Math.min(1, elapsed / durationMs);
      // Ease-out cubic so it slows as it approaches the final value
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(startVal + (target - startVal) * eased));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        // Pulse glow once the count-up finishes
        setGlow(true);
        window.setTimeout(() => setGlow(false), 900);
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    previousTargetRef.current = target;
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs, isStatic]);

  if (score === null || band === null) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs text-muted bg-surface border border-border">
        Not scored yet
      </span>
    );
  }

  const styles = BAND_STYLES[band];

  return (
    <div className="inline-flex items-center gap-2">
      <span
        className={[
          'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border',
          'transition-shadow duration-500',
          styles.wrap,
          glow ? styles.pulse : ''
        ].join(' ')}
        aria-live="polite"
      >
        <span className="tabular-nums">{display}</span>
        <span className="text-[11px] uppercase tracking-wider opacity-80">{band}</span>
      </span>
      {breakdown && (
        <div className="hidden md:flex items-center gap-2">
          <BreakdownBar label="Fit" value={breakdown.fit} durationMs={durationMs * 0.55} />
          <BreakdownBar label="Intent" value={breakdown.intent} durationMs={durationMs * 0.55} />
          <BreakdownBar label="Reach" value={breakdown.reachability} durationMs={durationMs * 0.55} />
          <BreakdownBar label="ICP" value={breakdown.icp_match} durationMs={durationMs * 0.55} />
        </div>
      )}
    </div>
  );
}

function BreakdownBar({
  label,
  value,
  durationMs
}: {
  label: string;
  value: number;
  durationMs: number;
}) {
  const v = clamp(value);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    // Defer one frame so the CSS transition has a 0% -> v% delta to animate
    const id = requestAnimationFrame(() => setWidth(v));
    return () => cancelAnimationFrame(id);
  }, [v]);
  return (
    <div className="w-14">
      <div className="flex justify-between items-baseline mb-0.5">
        <span className="text-[9px] uppercase tracking-wider text-muted">{label}</span>
        <span className="text-[10px] tabular-nums text-ink">{v}</span>
      </div>
      <div className="h-1 rounded-full bg-[var(--surface-2)] overflow-hidden">
        <div
          className="h-full bg-brand"
          style={{
            width: `${width}%`,
            transition: `width ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`
          }}
        />
      </div>
    </div>
  );
}
