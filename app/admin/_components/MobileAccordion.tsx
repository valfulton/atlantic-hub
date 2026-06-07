'use client';
/**
 * MobileAccordion — wrap any cockpit panel to make it collapse on phones while
 * staying untouched on desktop (val 2026-06-07 operator-mobile pass).
 *
 *   MOBILE (<768px): a 56px tappable header (icon · title · status · +/−).
 *     Body hidden by default; tap to expand. Desktop chrome gone.
 *   DESKTOP (>=768px): the header disappears entirely and the body always
 *     shows — a transparent pass-through, so existing layouts are UNCHANGED.
 *
 * One-open-at-a-time: pass `id` + listen via the QuickActionsRibbon, or drive
 * it controlled (`open` + `onToggle`) from a parent that closes siblings.
 * Auto-expand: dispatch `window` CustomEvent('macc-open', { detail: id }).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import './macc.css';

interface Props {
  title: string;
  status?: string;
  icon?: ReactNode;
  /** Stable id so the quick-actions ribbon can scroll-to + auto-expand it. */
  id?: string;
  defaultOpen?: boolean;
  /** Controlled mode (parent does one-open-at-a-time). */
  open?: boolean;
  onToggle?: (next: boolean) => void;
  children: ReactNode;
}

export default function MobileAccordion({
  title, status, icon, id, defaultOpen = false, open, onToggle, children
}: Props) {
  const controlled = open != null;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlled ? (open as boolean) : internalOpen;
  const ref = useRef<HTMLElement>(null);

  function setOpen(next: boolean) {
    if (controlled) onToggle?.(next);
    else setInternalOpen(next);
  }

  // Auto-expand + scroll when the ribbon (or anything) fires macc-open for this id.
  useEffect(() => {
    if (!id) return;
    function handler(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail !== id) return;
      setOpen(true);
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    window.addEventListener('macc-open', handler as EventListener);
    return () => window.removeEventListener('macc-open', handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, controlled]);

  return (
    <section ref={ref} id={id} className={`macc${isOpen ? ' is-open' : ''}`}>
      <button
        type="button"
        className="macc-head"
        aria-expanded={isOpen}
        onClick={() => setOpen(!isOpen)}
      >
        {icon && <span className="macc-icon" aria-hidden="true">{icon}</span>}
        <span className="macc-titles">
          <span className="macc-title">{title}</span>
          {status && <span className="macc-status">{status}</span>}
        </span>
        <span className="macc-toggle" aria-hidden="true">{isOpen ? '−' : '+'}</span>
      </button>
      <div className="macc-body">{children}</div>
    </section>
  );
}
