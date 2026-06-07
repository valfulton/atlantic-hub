'use client';
/**
 * FilterSheet — wraps a filter form so it collapses to a "Filters · N" chip on
 * phones and opens as a bottom-sheet (val 2026-06-07 operator-mobile). On
 * desktop it's a transparent pass-through — the form renders inline, unchanged.
 * The form (children) is rendered ONCE inside the panel, so no duplicate inputs.
 */
import { useState, type ReactNode } from 'react';
import './filtersheet.css';

export default function FilterSheet({ activeCount, children }: { activeCount: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fs">
      <button type="button" className="fs-chip" onClick={() => setOpen(true)}>
        <span aria-hidden="true">⚙</span> Filters{activeCount > 0 ? ` · ${activeCount}` : ''}
      </button>
      {open && (
        <button type="button" className="fs-backdrop" aria-label="Close filters" onClick={() => setOpen(false)} />
      )}
      <div className={`fs-panel${open ? ' is-open' : ''}`}>
        <div className="fs-panel-head">
          <span>Filters{activeCount > 0 ? ` · ${activeCount}` : ''}</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
