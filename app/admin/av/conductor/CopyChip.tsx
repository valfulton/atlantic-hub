'use client';
/**
 * CopyChip  (#295)
 *
 * Tiny click-to-copy chip used inside the Conductor Console's spin-up
 * cards. Pulled into its own client component so the page can stay a
 * server component (faster load, static rendering eligible).
 *
 * Visual: bg-brand text-black per contrast rule. Flashes "✓ Copied"
 * for 1.4s after a successful copy, "× Failed" on clipboard error
 * (rare — usually only on insecure-context browsers).
 */
import { useState } from 'react';

export function CopyChip({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function onClick() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setState('copied');
      } else {
        // Fallback for insecure contexts
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        setState(ok ? 'copied' : 'failed');
      }
    } catch {
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 1400);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      // Contrast rule: bg-brand always text-black.
      className="text-[10.5px] uppercase tracking-[0.14em] font-medium px-2.5 py-1 rounded-md bg-brand text-black hover:opacity-90 shrink-0"
    >
      {state === 'copied' ? '✓ Copied' : state === 'failed' ? '× Failed' : 'Copy prompt'}
    </button>
  );
}
