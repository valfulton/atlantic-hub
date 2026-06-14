'use client';

/**
 * Tiny client component — copies the magic link to the clipboard.
 * Used by /admin/av/access-audit so val can grab a working URL per user
 * with one click, no SQL.
 */
import { useState } from 'react';

export default function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handle() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore — modern browsers all support this */
    }
  }

  return (
    <button
      type="button"
      onClick={handle}
      style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
        padding: '4px 10px', borderRadius: 6,
        background: copied ? 'rgba(10,77,60,0.18)' : 'rgba(10,77,60,0.08)',
        border: '1px solid rgba(10,77,60,0.35)',
        color: '#0A4D3C', cursor: 'pointer'
      }}
    >
      {copied ? 'Copied ✓' : 'Copy magic link'}
    </button>
  );
}
