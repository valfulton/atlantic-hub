'use client';

/**
 * Collapsible — a luxury-nautical disclosure section for the client dashboard.
 *
 * Keeps the page calm: the Creative Brief stays open as the centerpiece;
 * everything else (campaigns, content, audit, plan) collapses to a single calm
 * header row with a small meta count, expanding on click. Server-rendered
 * children are passed straight through.
 */
import { useState, type ReactNode } from 'react';

export default function Collapsible({
  title,
  meta,
  defaultOpen = false,
  children
}: {
  title: string;
  meta?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-4 rounded-2xl border border-border bg-surface/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 sm:px-6 py-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--signal)' }} aria-hidden="true" />
        <span className="text-base sm:text-lg font-semibold text-ink">{title}</span>
        {meta && <span className="text-xs text-muted">{meta}</span>}
        <span className="ml-auto text-muted text-xl leading-none select-none" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="px-5 sm:px-6 pb-6">{children}</div>}
    </section>
  );
}
