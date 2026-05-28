/**
 * components/BrandSeal.tsx
 *
 * The Atlantic & Vine brand mark mounted on a refined red field.
 *
 * Rules (per val, 2026-05-28):
 *   - DO NOT modify the logo artwork. It mounts unmodified.
 *   - DO NOT mount on a dark background — the logo has black in it and will
 *     dissolve into navy/black/charcoal. This component owns its own
 *     light-by-design red panel; place it on any surface.
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
  // The logo sits centered with breathing room. A ratio close to 0.82 keeps
  // the gold mark readable without crowding the red field.
  const logoPx = Math.round(px * 0.82);
  const radius = Math.round(px * 0.18); // soft rounded square, not a circle

  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
      style={{
        width: px,
        height: px,
        background: SEAL_RED,
        borderRadius: radius,
        boxShadow: `0 4px 18px -6px ${SEAL_RED_GLOW}, inset 0 0 0 1px rgba(255,255,255,0.04)`
      }}
    >
      <img
        src="/brand/av-logo.png"
        alt=""
        width={logoPx}
        height={logoPx}
        style={{ display: 'block', objectFit: 'contain' }}
        draggable={false}
      />
    </span>
  );
}
