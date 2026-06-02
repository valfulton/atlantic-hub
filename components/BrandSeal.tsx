/**
 * components/BrandSeal.tsx
 *
 * The Atlantic & Vine brand mark — gold logo on whatever ground it's
 * placed against.
 *
 * Rules (per val, 2026-05-28 → 2026-06-01):
 *   - DO NOT modify the logo artwork. It mounts unmodified.
 *   - Logo source = `/brand/av_logo_white1152.png` (canonical AV logo,
 *     gold-on-transparent — designed to sit directly on the parent ground).
 *   - No background field, no border-radius, no box-shadow. The previous
 *     burgundy seal was only needed for the OLD asset's black backdrop;
 *     the new gold-on-transparent reads cleanly on dark navy + on light
 *     grounds without any wrapper styling. Dropped 2026-06-02.
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

export default function BrandSeal({
  size = 'md',
  className = '',
  title = 'Atlantic & Vine'
}: BrandSealProps) {
  const px = SIZE_PX[size];
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: px, height: px }}
    >
      <img
        src="/brand/av_logo_white1152.png"
        alt=""
        width={px}
        height={px}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          objectFit: 'contain'
        }}
        draggable={false}
      />
    </span>
  );
}
