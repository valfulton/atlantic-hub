'use client';

/**
 * SuggestField — an input/textarea whose example is a SUGGESTION YOU CAN USE,
 * not dead placeholder text.
 *
 * The problem it fixes: a normal `placeholder` is un-selectable, un-editable
 * dummy text that disappears the moment you type — you can never actually use
 * the suggested value. This shows the same smart example, but as a one-click
 * "Use" chip beneath an empty field: click it and the suggestion becomes the
 * field's real, editable value.
 *
 * Reusable anywhere: pass `value`, `onChange`, and `suggestion`. A faint
 * placeholder still shows the hint while typing; the chip only appears when the
 * field is empty AND a suggestion exists.
 */
import { useId } from 'react';

const chipStyle: React.CSSProperties = {
  display: 'inline-block',
  marginTop: 4,
  padding: '2px 8px',
  borderRadius: 999,
  border: '1px solid rgba(255,199,61,0.35)',
  background: 'rgba(255,199,61,0.08)',
  color: '#f5c453',
  fontSize: 11,
  cursor: 'pointer',
  lineHeight: 1.4
};

const baseInput: React.CSSProperties = {
  width: '100%',
  background: 'rgba(2,6,23,0.6)',
  border: '1px solid rgba(148,163,184,0.2)',
  borderRadius: 8,
  padding: '7px 10px',
  color: '#e2e8f0',
  fontSize: 13
};

interface Common {
  value: string;
  onChange: (v: string) => void;
  /** The intelligent example. Shown as a faint hint and as a click-to-use chip. */
  suggestion?: string | null;
  placeholderHint?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}

function Chip({ suggestion, onUse }: { suggestion: string; onUse: () => void }) {
  return (
    <button type="button" onClick={onUse} style={chipStyle} title="Use this suggestion">
      Use: {suggestion}
    </button>
  );
}

export function SuggestInput({ value, onChange, suggestion, placeholderHint, style, ariaLabel }: Common) {
  const id = useId();
  const showChip = !value.trim() && !!suggestion;
  return (
    <div>
      <input
        id={id}
        aria-label={ariaLabel}
        style={{ ...baseInput, ...style }}
        value={value}
        placeholder={placeholderHint ?? suggestion ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
      {showChip && <Chip suggestion={suggestion as string} onUse={() => onChange(suggestion as string)} />}
    </div>
  );
}

export function SuggestTextarea({ value, onChange, suggestion, placeholderHint, style, ariaLabel }: Common) {
  const id = useId();
  const showChip = !value.trim() && !!suggestion;
  return (
    <div>
      <textarea
        id={id}
        aria-label={ariaLabel}
        style={{ ...baseInput, minHeight: 52, ...style }}
        value={value}
        placeholder={placeholderHint ?? suggestion ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
      {showChip && <Chip suggestion={suggestion as string} onUse={() => onChange(suggestion as string)} />}
    </div>
  );
}
