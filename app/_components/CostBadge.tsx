'use client';

/**
 * CostBadge + ModelBadge  (#363, val 2026-06-02)
 *
 * Tiny inline pills for surfacing what an LLM call cost + which model ran it.
 * Both auto-hide when the Presentation Mode cookie is set, so val can flip a
 * single toggle in the sidebar and every cost/model label disappears across
 * the hub (investor demo, client meeting, etc.).
 *
 * Cost is rendered in cents with smart precision:
 *   < 0.1¢  -> "<0.1¢"
 *   < 10¢   -> "0.3¢" / "2.4¢"
 *   < $1    -> "23¢"
 *   >= $1   -> "$1.04"
 */
import { useEffect, useState } from 'react';
import { isPresentationModeClient } from '@/lib/ui/presentation_mode';

function microcentsLabel(microcents: number | null | undefined): string {
  if (microcents == null) return '—';
  const cents = microcents / 1000;
  if (cents <= 0) return '0¢';
  if (cents < 0.1) return '<0.1¢';
  if (cents < 10) return `${cents.toFixed(1)}¢`;
  if (cents < 100) return `${Math.round(cents)}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

/** Read the cookie ONCE per mount; respect SSR by starting null. */
function usePresentationHidden(): boolean {
  const [hidden, setHidden] = useState<boolean>(false);
  useEffect(() => {
    setHidden(isPresentationModeClient());
  }, []);
  return hidden;
}

export function CostBadge({
  microcents,
  source = 'live',
  className = ''
}: {
  microcents: number | null | undefined;
  /** 'cache' renders as $0 with a cache hint (still a real call val can rely on). */
  source?: 'live' | 'cache';
  className?: string;
}) {
  const hidden = usePresentationHidden();
  if (hidden) return null;
  if (microcents == null) return null;
  const cached = source === 'cache';
  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-mono tabular-nums ' +
        (cached
          ? 'border-emerald-400/30 bg-emerald-400/[0.05] text-emerald-300/85'
          : 'border-border/60 bg-black/20 text-muted') +
        ' ' + className
      }
      title={cached ? 'Cache hit — no charge' : 'Live LLM call'}
    >
      {cached ? '0¢ (cache)' : microcentsLabel(microcents)}
    </span>
  );
}

export function ModelBadge({
  model,
  className = ''
}: {
  model: string | null | undefined;
  className?: string;
}) {
  const hidden = usePresentationHidden();
  if (hidden) return null;
  if (!model) return null;
  // Strip the 'provider:' prefix for display since the colon makes it look like a type.
  const display = model.includes(':') ? model.split(':').slice(1).join(':') : model;
  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded-full border border-border/60 bg-black/20 px-1.5 py-0.5 text-[10px] font-mono text-muted ' +
        className
      }
      title={`Model: ${model}`}
    >
      {display}
    </span>
  );
}
