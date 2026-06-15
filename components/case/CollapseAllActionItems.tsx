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

  // (val 2026-06-15, #692) Quiet tertiary: this is a SUB-CONTROL, not the
  // main interactive surface. Strip the border + uppercase so the section
  // header reads as primary. Stop click from bubbling to <summary> so the
  // toggle doesn't also collapse the section it lives in.
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(); }}
      className="ai-collapse-all"
      style={{
        background: 'transparent',
        border: 'none',
        color: 'var(--muted, #5C6862)',
        fontSize: 12,
        fontWeight: 400,
        textDecoration: 'underline',
        textDecorationStyle: 'dotted',
        textUnderlineOffset: 3,
        padding: '4px 2px',
        cursor: 'pointer'
      }}
    >
      {anyOpen ? 'Collapse all' : 'Expand all'}
    </button>
  );
}
