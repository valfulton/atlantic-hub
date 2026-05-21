'use client';

import { useState } from 'react';

interface Props {
  value: string;
  label?: string;
}

/**
 * Small client component used by the Clay status page to copy the webhook
 * URL. Server-renders inert ("Copy URL") and gains clipboard behavior on
 * hydration. Falls back to a temp textarea + execCommand if the modern
 * Clipboard API is unavailable (older Safari, http://localhost).
 */
export function CopyButton({ value, label = 'Copy' }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  async function copy() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const t = document.createElement('textarea');
        t.value = value;
        t.style.position = 'fixed';
        t.style.opacity = '0';
        document.body.appendChild(t);
        t.select();
        document.execCommand('copy');
        document.body.removeChild(t);
      }
      setState('copied');
      window.setTimeout(() => setState('idle'), 1500);
    } catch {
      setState('error');
      window.setTimeout(() => setState('idle'), 2500);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="px-3 py-2 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/40 text-xs font-medium hover:bg-amber-500/25 focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2"
      aria-live="polite"
    >
      {state === 'copied' ? 'Copied' : state === 'error' ? 'Copy failed' : label}
    </button>
  );
}
