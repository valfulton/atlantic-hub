/**
 * components/SectionHead.tsx  (V3, val 2026-06-03)
 *
 * Replaces WaveDivider as the section header pattern. Carries:
 *   - kicker  (uppercase tag, tracking-wide, brand color)
 *   - title   (main headline, ink, semibold, mobile-flexible)
 *   - dek     (optional one-line subhead, muted)
 *   - children (optional trailing slot for date chip / calendar link /
 *               newsroom link / latest-ad link)
 *
 * Visual rule: a single 1px champagne line draws in horizontally on mount
 * (animation: ~600ms ease-out). That's the only motion. Luxury, not jumpy.
 *
 * Mobile: kicker + title stack tight, line + trailing slot wrap below.
 * Desktop: title + dek + line + trailing slot in a generous column.
 *
 * Drop-in replacement for <WaveDivider /> usages at the top of major
 * sections. Trailing children make this future-proof — links to calendar
 * / newsroom / latest-ad land in the same slot without redesign.
 */
import { ReactNode } from 'react';

interface SectionHeadProps {
  kicker?: string;
  title: string;
  dek?: string;
  /** Trailing slot — date chip, calendar link, newsroom link, latest-ad link. */
  children?: ReactNode;
  /** Tone family. Default champagne; can switch for distress (coral) etc. */
  tone?: 'brand' | 'sky' | 'coral' | 'sea' | 'amber';
  className?: string;
}

const TONE_LINE: Record<NonNullable<SectionHeadProps['tone']>, string> = {
  brand: 'from-[#C99858] via-[#C99858]/40 to-transparent',
  sky: 'from-[#6FB1E0] via-[#6FB1E0]/40 to-transparent',
  coral: 'from-[#E1758A] via-[#E1758A]/40 to-transparent',
  sea: 'from-[#7CC4A1] via-[#7CC4A1]/40 to-transparent',
  amber: 'from-[#E6B45A] via-[#E6B45A]/40 to-transparent'
};

const TONE_KICKER: Record<NonNullable<SectionHeadProps['tone']>, string> = {
  brand: 'text-brand',
  sky: 'text-sky-300',
  coral: 'text-rose-300',
  sea: 'text-emerald-300',
  amber: 'text-[#EBCB6B]'
};

export default function SectionHead({
  kicker,
  title,
  dek,
  children,
  tone = 'brand',
  className = ''
}: SectionHeadProps) {
  return (
    <header className={`mb-5 sm:mb-6 ${className}`}>
      {kicker && (
        <div className={`text-[10px] uppercase tracking-[0.22em] mb-2 ${TONE_KICKER[tone]}`}>
          {kicker}
        </div>
      )}
      <h2 className="text-xl sm:text-2xl font-semibold text-ink tracking-tight break-words">
        {title}
      </h2>
      {dek && (
        <p className="mt-1.5 text-sm text-muted max-w-xl leading-relaxed">
          {dek}
        </p>
      )}
      {/* The line — draws in via CSS keyframes. */}
      <div
        className={`relative mt-3 h-px overflow-hidden`}
        aria-hidden="true"
      >
        <div
          className={`absolute inset-y-0 left-0 w-[120px] sm:w-[180px] bg-gradient-to-r ${TONE_LINE[tone]} origin-left`}
          style={{
            animation: 'sectionHeadDraw 600ms cubic-bezier(0.22, 1, 0.36, 1) both'
          }}
        />
      </div>
      {/* Trailing slot — date chip + links wrap below the line. */}
      {children && (
        <div className="mt-3 flex items-center gap-3 flex-wrap text-[11px] text-muted">
          {children}
        </div>
      )}
      {/* Keyframes — scoped via style tag so we don't depend on a global stylesheet. */}
      <style jsx>{`
        @keyframes sectionHeadDraw {
          from {
            transform: scaleX(0);
            opacity: 0;
          }
          to {
            transform: scaleX(1);
            opacity: 1;
          }
        }
      `}</style>
    </header>
  );
}

/* -----------------------------------------------------------------------
 * Example usage:
 *
 *   <SectionHead
 *     kicker="Your campaign, live"
 *     title={`Welcome back, ${firstName}.`}
 *     dek={`${pipeline.hot} hot leads ready to move.`}
 *     tone="brand"
 *   >
 *     <span>Today · Wed Jun 3</span>
 *     <Link href="/calendar" className="hover:text-ink">Open calendar →</Link>
 *     <Link href="/newsroom" className="hover:text-ink">View live content →</Link>
 *   </SectionHead>
 * -----------------------------------------------------------------------
 */
