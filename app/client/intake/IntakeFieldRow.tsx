'use client';

/**
 * IntakeFieldRow — collapsed-by-default intake question (#555).
 *
 * Replaces the loud "YOUR TURN" gold pill pattern with:
 *   - a discrete red tick when unanswered
 *   - a one-line value preview when answered
 *   - a gold chevron > as the universal "expand for more" affordance
 *   - tap-anywhere-on-the-row to expand on mobile (≥44px tap target)
 *
 * The actual input + help text + provenance ("Used for…") line are mounted but
 * visually hidden when collapsed, so autosave + autofocus logic stays intact
 * and nothing flickers during streaming.
 */
import { useRef, useState } from 'react';

export type IntakeFieldStatus = 'unanswered' | 'answered' | 'in_progress';

export type IntakeFieldRowProps = {
  /** Field label, e.g. "Your one-line tagline" */
  label: string;
  /** What the field is used for (renders below the input when expanded) */
  helpText?: string;
  /** Provenance / "used for" line — renders below help when expanded */
  usedFor?: string;
  /** Status — drives tick visibility */
  status: IntakeFieldStatus;
  /** One-line preview of the answer to show next to the label when collapsed */
  valuePreview?: string;
  /** Expand by default? Use for the first unanswered field (resume-where-you-left-off) */
  defaultExpanded?: boolean;
  /** The input itself — textarea, select, file uploader, BrandColorPicker, etc. */
  children: React.ReactNode;
  /** Optional className passthrough */
  className?: string;
};

export default function IntakeFieldRow({
  label,
  helpText,
  usedFor,
  status,
  valuePreview,
  defaultExpanded = false,
  children,
  className
}: IntakeFieldRowProps) {
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded || status === 'in_progress');
  const detailsRef = useRef<HTMLDivElement | null>(null);

  function toggle() {
    setExpanded((v) => !v);
  }

  const showTick = status === 'unanswered';
  const previewWhenCollapsed = !expanded && status === 'answered' && valuePreview;

  return (
    <div
      className={`intake-row ${className ?? ''}`}
      data-expanded={expanded ? 'true' : 'false'}
      data-status={status}
      style={{
        background: 'var(--paper, #FFFDF5)',
        border: '0.5px solid var(--card-border, rgba(10,10,10,0.10))',
        borderRadius: 10,
        marginBottom: 8,
        overflow: 'hidden',
        transition: 'border-color 0.15s ease'
      }}
    >
      {/* Header row — always visible, tap-anywhere to toggle. */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        style={{
          width: '100%',
          minHeight: 44,
          background: 'transparent',
          border: 'none',
          padding: '12px 14px',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          fontFamily: 'inherit'
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap'
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--ink, #0A0A0A)'
            }}
          >
            {label}
          </span>
          {showTick ? (
            <span
              aria-label="needs your answer"
              title="needs your answer"
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--alert-soft, #C97E8B)',
                flex: '0 0 auto'
              }}
            />
          ) : null}
          {previewWhenCollapsed ? (
            <span
              style={{
                fontSize: 12,
                color: 'var(--ink-soft, #5F5E5A)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0
              }}
            >
              {valuePreview!.length > 80 ? valuePreview!.slice(0, 79) + '…' : valuePreview}
            </span>
          ) : null}
        </span>
        <span
          aria-hidden="true"
          className="intake-chev"
          style={{
            color: 'var(--gold-bright, #EBCB6B)',
            opacity: 0.85,
            display: 'inline-block',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
            fontSize: 14,
            lineHeight: 1
          }}
        >
          ›
        </span>
      </button>

      {/* Detail surface — mounted always, visually hidden when collapsed so autosave is safe. */}
      <div
        ref={detailsRef}
        style={{
          padding: expanded ? '0 14px 14px' : 0,
          maxHeight: expanded ? 'none' : 0,
          opacity: expanded ? 1 : 0,
          overflow: 'hidden',
          // The mounted-but-clipped pattern preserves input refs + autofocus state.
          // We don't `display: none` because that loses focus + input event timing.
          pointerEvents: expanded ? 'auto' : 'none',
          transition: 'opacity 0.15s ease'
        }}
        aria-hidden={!expanded}
      >
        {helpText ? (
          <p
            style={{
              margin: '0 0 8px',
              fontSize: 12,
              color: 'var(--ink-soft, #5F5E5A)',
              lineHeight: 1.5
            }}
          >
            {helpText}
          </p>
        ) : null}
        <div>{children}</div>
        {usedFor ? (
          <p
            style={{
              margin: '8px 0 0',
              fontSize: 11,
              color: 'var(--ink-soft, #5F5E5A)',
              fontStyle: 'italic'
            }}
          >
            Used for: {usedFor}
          </p>
        ) : null}
      </div>
    </div>
  );
}
