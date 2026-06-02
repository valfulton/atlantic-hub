/**
 * components/BrandSeal.tsx
 *
 * The Atlantic & Vine brand mark mounted on a refined red field.
 *
 * Rules (per val, 2026-05-28; logo asset updated 2026-06-01):
 *   - DO NOT modify the logo artwork. It mounts unmodified.
 *   - Logo source = `/brand/av_logo_white1152.png` (canonical AV logo,
 *     gold-on-transparent — designed for light grounds; the red field below
 *     IS the light ground from the logo's perspective).
 *   - Motion is reserved for a future pass (#186 phase 2). Today it sits.
 *   - One CSS slot system: pass a `size` prop, mount anywhere.
 *
 * Usage:
 *   <BrandSeal />              // default md, ~40px square
 *   <BrandSeal size="sm" />    // header inline
 *   <BrandSeal size="lg" />    // splash / hero
 *   <BrandSeal className="..." /> // override positioning
 */

interface BrandSealProps {
  /** Visual size. `sm` for nav inline (~32px), `md` for header (~40px), `lg` for hero (~96px). */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Optional override (positioning, margin, etc). Doesn't affect inner sizing. */
  className?: string;
  /** Optional title for accessibility (defaults to "Atlantic & Vine"). */
  title?: string;
}

const SIZE_PX: Record<NonNullable<BrandSealProps['size']>, number> = {
  sm: 32,
  md: 40,
  lg: 96,
  xl: 160
};

// Refined burgundy — editorial, never glaring. The single source of brand red.
const SEAL_RED = '#7C1F2C';
const SEAL_RED_GLOW = 'rgba(124,31,44,0.35)';

export default function BrandSeal({
  size = 'md',
  className = '',
  title = 'Atlantic & Vine'
}: BrandSealProps) {
  const px = SIZE_PX[size];
  // The new canonical logo (av_logo_white1152.png) is gold-on-transparent —
  // no black backdrop to dissolve. So we drop the `mix-blend-mode: screen`
  // hack the old asset needed, and a contain-fit at near 1:1 reads cleanly
  // on the burgundy field. Slight overscan (1.1x) so the gold artwork
  // breathes to the edge of the seal without being clipped.
  const logoPx = Math.round(px * 1.1);
  const radius = Math.round(px * 0.18); // soft rounded square, not a circle

  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={`inline-flex items-center justify-center shrink-0 overflow-hidden ${className}`}
      style={{
        width: px,
        height: px,
        background: SEAL_RED,
        borderRadius: radius,
        boxShadow: `0 4px 18px -6px ${SEAL_RED_GLOW}, inset 0 0 0 1px rgba(255,255,255,0.04)`
      }}
    >
      <img
        src="/brand/av_logo_white1152.png"
        alt=""
        width={logoPx}
        height={logoPx}
        style={{
          display: 'block',
          objectFit: 'contain'
        }}
        draggable={false}
      />
    </span>
  );
}
