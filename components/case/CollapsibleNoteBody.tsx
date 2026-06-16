'use client';

/**
 * CollapsibleNoteBody  (val 2026-06-16, #709)
 *
 * Wraps a long case-note body in a "Show more / Show less" toggle.
 * Short notes (<= 6 lines OR <= 320 chars) render in full with no
 * toggle. Long notes show a clamped preview + "Show more →" button.
 *
 * Family-side only — Adriana's letters are LONG and clobber the page.
 * Operator side keeps the full render because operators need scan-density.
 */

import { useState } from 'react';

interface Props {
  body: string;
  /** Inline style for the body text — passed from parent so look stays consistent. */
  style?: React.CSSProperties;
  /** Optional sign-off block rendered after body. Shown only when expanded. */
  signOff?: React.ReactNode;
}

/** Threshold above which we collapse by default. */
const CHAR_THRESHOLD = 320;
const LINE_THRESHOLD = 6;

export default function CollapsibleNoteBody({ body, style, signOff }: Props) {
  const lines = body.split('\n').length;
  const longByChars = body.length > CHAR_THRESHOLD;
  const longByLines = lines > LINE_THRESHOLD;
  const needsCollapse = longByChars || longByLines;
  const [open, setOpen] = useState(false);

  if (!needsCollapse) {
    return (
      <>
        <div style={style}>{body}</div>
        {signOff}
      </>
    );
  }

  // Preview: first 3 lines OR first 220 chars, whichever is shorter.
  const previewByLines = body.split('\n').slice(0, 3).join('\n');
  const previewByChars = body.slice(0, 220);
  const preview = previewByLines.length < previewByChars.length
    ? previewByLines
    : previewByChars;

  const linkStyle: React.CSSProperties = {
    marginTop: 10,
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--emerald-deep, #0A4D3C)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'underline',
    textUnderlineOffset: 3
  };

  return (
    <>
      <div style={style}>
        {open ? body : (
          <>
            {preview}
            <span style={{ color: 'var(--muted, #5C6862)' }}>… </span>
          </>
        )}
      </div>
      {open && signOff}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={linkStyle}
        aria-expanded={open}
      >
        {open ? 'Show less ↑' : 'Show more →'}
      </button>
    </>
  );
}
