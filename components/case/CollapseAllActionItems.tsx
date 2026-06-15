'use client';

/**
 * CollapseAllActionItems  (val 2026-06-15, #688)
 *
 * Bulk Expand / Collapse toggle for the family-side "Outstanding items"
 * list. The list uses native <details> elements so the underlying open
 * state is per-element; this component just walks the DOM under a scope
 * selector and flips `.open` on every match.
 *
 * Why a client component for one button: the rest of the family case page
 * is a Server Component, and native <details> can't be driven from a
 * server render after hydration. This is the minimum island we need.
 */

import { useEffect, useState } from 'react';

interface Props {
  /**
   * CSS selector for the <details> elements to control. Defaults to
   * '.ai-collapse' which matches what the family case page renders today.
   */
  selector?: string;
}

export default function CollapseAllActionItems({ selector = '.ai-collapse' }: Props) {
  const [anyOpen, setAnyOpen] = useState(true);

  // (#688) Sync our button label with the actual DOM state on first paint
  // — items default `open` in markup but a user may have collapsed some
  // already. We re-check after toggle as well.
  useEffect(() => {
    const els = document.querySelectorAll<HTMLDetailsElement>(selector);
    setAnyOpen(Array.from(els).some((el) => el.open));
  }, [selector]);

  function toggle() {
    const els = document.querySelectorAll<HTMLDetailsElement>(selector);
    // If ANY is currently open, collapse all. Otherwise expand all.
    const shouldOpen = !Array.from(els).some((el) => el.open);
    for (const el of els) el.open = shouldOpen;
    setAnyOpen(shouldOpen);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="ai-collapse-all"
      style={{
        background: 'transparent',
        border: '1px solid rgba(10,77,60,0.25)',
        color: 'var(--emerald-deep, #0A4D3C)',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        padding: '5px 10px',
        borderRadius: 6,
        cursor: 'pointer'
      }}
    >
      {anyOpen ? 'Collapse all' : 'Expand all'}
    </button>
  );
}
