'use client';

/**
 * PresentationModeToggle  (#361, val 2026-06-02)
 *
 * Sticky toggle in the operator nav. Sets the av_presentation_mode cookie
 * via document.cookie + reloads so server-rendered surfaces pick it up.
 *
 * When ON: cost badges, model names, HTTP failure reasons, "no LLM fired"
 * status labels all hide. Hub looks like a polished SaaS product.
 * When OFF: all engineering reality on display.
 */
import { useEffect, useState } from 'react';
import { PRESENTATION_COOKIE } from '@/lib/ui/presentation_mode';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1] ?? '') : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  const oneYear = 365 * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${oneYear}; SameSite=Lax`;
}

export default function PresentationModeToggle() {
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    const v = readCookie(PRESENTATION_COOKIE);
    setOn(v === '1' || v === 'true');
  }, []);

  function toggle() {
    const next = !on;
    writeCookie(PRESENTATION_COOKIE, next ? '1' : '0');
    setOn(next);
    // Soft reload so server components re-render with the new cookie.
    if (typeof window !== 'undefined') window.location.reload();
  }

  if (on === null) return null; // avoid SSR/CSR mismatch flash

  return (
    <button
      type="button"
      onClick={toggle}
      title={
        on
          ? 'Presentation mode ON — cost / model / tech labels hidden. Click to turn off.'
          : 'Presentation mode OFF — full engineering view. Click to turn on for an investor demo.'
      }
      className={
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] transition-colors ' +
        (on
          ? 'border-brand/50 bg-brand/15 text-brand'
          : 'border-border/60 bg-black/20 text-muted hover:text-ink hover:bg-white/[0.03]')
      }
    >
      <span aria-hidden className={`inline-block w-1.5 h-1.5 rounded-full ${on ? 'bg-brand' : 'bg-muted/50'}`} />
      Presentation {on ? 'on' : 'off'}
    </button>
  );
}
