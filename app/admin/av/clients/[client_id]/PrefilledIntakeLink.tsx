'use client';

/**
 * PrefilledIntakeLink — the no-login share link to this client's PREFILLED intake.
 * Copy it and send it; they open it and fill their form. No password, no sign-in,
 * no gate. (Different from the magic link, which logs them into the portal.)
 */
import { useState } from 'react';

export default function PrefilledIntakeLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-1">
        Prefilled intake link — no login, just send it
      </div>
      <p className="text-xs text-muted mb-2 leading-relaxed">
        Opens straight to their filled-in intake form. They review, complete it, and submit — no password, no portal sign-in.
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink"
        />
        <button
          onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); }}
          className="shrink-0 rounded-lg px-3 text-sm font-medium"
          style={{ background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)', color: '#1a1207', border: 'none' }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
    </div>
  );
}
