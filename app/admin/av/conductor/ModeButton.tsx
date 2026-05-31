'use client';
/**
 * ModeButton  (#295)
 *
 * Click-to-copy directive button for the Conductor Console. Each mode
 * carries a pre-built prompt val pastes at the top of a new Claude chat
 * to pre-bundle a behavior contract (ship-only, design-first, parallel,
 * etc.) — so she doesn't have to repeat in-flight corrections that have
 * already cost her time on past sessions.
 *
 * Visual rules: follows feedback_contrast_rule (no white-on-amber).
 * Idle state is dark surface with amber accent + the mode icon; copied
 * state briefly flashes brand amber w/ text-black (the rule) with a
 * checkmark to confirm. Reverts after ~1.6s.
 *
 * Self-contained client component. No dependencies beyond React +
 * the navigator.clipboard browser API. Falls back to a textarea +
 * execCommand for clipboards that block on insecure contexts.
 */
import { useState } from 'react';

interface ModeButtonProps {
  icon: string;
  label: string;
  /** One-sentence "what this mode does for you" — sits under the label. */
  blurb: string;
  /** The directive prompt that lands in the clipboard. Will be pasted into
   *  a new Claude chat verbatim, so write it in second person + present-tense. */
  prompt: string;
}

async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  // Fallback for insecure contexts / older browsers.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function ModeButton({ icon, label, blurb, prompt }: ModeButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function onClick() {
    const ok = await writeToClipboard(prompt);
    setState(ok ? 'copied' : 'failed');
    window.setTimeout(() => setState('idle'), 1600);
  }

  // (#293/#295) Contrast rule — when the button flashes brand-amber on the
  // copied state, the text MUST be black, not white. Idle state stays on a
  // dark surface with amber accent (legible at any zoom).
  const isCopied = state === 'copied';
  const isFailed = state === 'failed';
  const bgClass = isCopied
    ? 'bg-brand text-black border-brand'
    : isFailed
      ? 'bg-rose-900/30 text-rose-100 border-rose-500/40'
      : 'bg-surface text-ink border-border hover:border-brand/60';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative w-full text-left rounded-2xl border p-4 transition-colors ${bgClass}`}
      title="Click to copy the directive prompt — paste into a new Claude chat to pre-bundle the mode."
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none shrink-0" aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className={`text-[13.5px] font-semibold leading-snug ${isCopied ? 'text-black' : 'text-ink'}`}>
            {label}
          </div>
          <p className={`text-[11.5px] leading-snug mt-1 ${isCopied ? 'text-black/75' : 'text-muted'}`}>
            {blurb}
          </p>
        </div>
        <span
          aria-hidden="true"
          className={`text-[10px] uppercase tracking-[0.14em] font-medium shrink-0 ${
            isCopied ? 'text-black' : isFailed ? 'text-rose-200' : 'text-muted group-hover:text-brand'
          }`}
        >
          {isCopied ? '✓ Copied' : isFailed ? 'Copy failed' : 'Copy'}
        </span>
      </div>
    </button>
  );
}
