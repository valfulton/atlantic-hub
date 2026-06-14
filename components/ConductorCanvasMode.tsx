'use client';

/**
 * ConductorCanvasMode (val 2026-06-13)
 * ─────────────────────────────────────────────────────────────────
 * Conductor's screenshot/zoom-out mode. One click hides EVERY piece
 * of platform chrome so val can capture the actual content unimpeded:
 *
 *   - Sidebar (the dark operator nav, full width 256px)
 *   - MONITORING ticker banner at the top of every operator page
 *   - OperatorPreviewChrome banner on preview routes
 *   - ViewAsPicker bar
 *   - Any other element tagged data-chrome="hide-in-canvas"
 *
 * Toggle lives in the bottom-right corner — small, persistent, never
 * in the way. Press once: chrome gone. Press again: restored.
 * Persists in localStorage so the mode survives navigation/reload.
 *
 * Mechanism: sets a body attribute `data-canvas-mode="full"`. The
 * companion CSS rule in globals.css matches that attribute and hides
 * the chrome via display: none (cleaner than visibility/opacity which
 * still reserve layout space).
 *
 * Mount globally in the operator layout. No-op on client surfaces.
 */
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'av_conductor_canvas_mode';

export default function ConductorCanvasMode() {
  const [active, setActive] = useState(false);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === '1') {
        setActive(true);
      }
    } catch {
      /* swallow */
    }
  }, []);

  // Apply / remove the body attribute whenever active changes.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (active) {
      document.body.setAttribute('data-canvas-mode', 'full');
    } else {
      document.body.removeAttribute('data-canvas-mode');
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, active ? '1' : '0');
    } catch {
      /* swallow */
    }
    return () => {
      // Don't strip the attribute on unmount — the mode should persist
      // until the user explicitly toggles it off.
    };
  }, [active]);

  return (
    <button
      type="button"
      onClick={() => setActive((v) => !v)}
      aria-label={active ? 'Show chrome' : 'Hide chrome (canvas mode)'}
      title={active ? 'Show all UI chrome' : 'Hide all UI chrome (screenshot mode)'}
      style={{
        position: 'fixed',
        bottom: 18,
        right: 18,
        zIndex: 9999,
        height: 36,
        padding: '0 14px',
        borderRadius: 18,
        border: '1px solid rgba(235, 203, 107, 0.45)',
        background: active ? 'rgba(235, 203, 107, 0.18)' : 'rgba(10, 15, 26, 0.85)',
        backdropFilter: 'blur(10px)',
        color: active ? '#F5D87A' : '#EBCB6B',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.06em',
        cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {active ? (
          // Eye-off icon when active (click to show chrome again)
          <>
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="m1 1 22 22" />
          </>
        ) : (
          // Maximize icon when inactive (click to enter canvas mode)
          <>
            <path d="M3 9V3h6" />
            <path d="M21 9V3h-6" />
            <path d="M3 15v6h6" />
            <path d="M21 15v6h-6" />
          </>
        )}
      </svg>
      {active ? 'EXIT CANVAS' : 'CANVAS MODE'}
    </button>
  );
}
