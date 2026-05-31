'use client';

/**
 * PrefilledIntakeLink — the no-login share link to this client's PREFILLED intake.
 * Copy it and send it; they open it and fill their form. No password, no sign-in,
 * no gate. (Different from the magic link, which logs them into the portal.)
 *
 * (#297) Surfaced expiry + shareability warning inline so val never has to guess
 * "wait, how long does this link last?" or "can anyone with the URL fill it?".
 * Also switched the Copy button to bg-brand text-black per the contrast rule
 * (the inline amber gradient drifted from the rest of the system).
 */
import { useState } from 'react';

export default function PrefilledIntakeLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  function onCopy() {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-3">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted">
          Prefilled intake link — no login, just send it
        </div>
        <span className="text-[10px] text-muted/80 shrink-0" title="Token signed for this client only; rejects after 30 days.">
          Expires in 30 days
        </span>
      </div>
      <p className="text-xs text-muted mb-2 leading-relaxed">
        Opens straight to their filled-in intake form. They review, complete it, and submit — no password, no portal sign-in.
        <span className="block mt-1 text-amber-300/85">
          ⚠ Anyone with this URL can fill the form. Don&apos;t post it publicly.
        </span>
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink"
        />
        <button
          type="button"
          onClick={onCopy}
          // Contrast rule: bg-brand always text-black.
          className="shrink-0 rounded-lg px-3 text-sm font-medium bg-brand text-black hover:opacity-90"
        >
          {copied ? '✓ Copied' : 'Copy link'}
        </button>
      </div>
    </div>
  );
}
