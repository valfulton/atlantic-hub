'use client';

/**
 * OwnerIntakeLink  (#45 Phase B)
 *
 * The all-brands intake link for a multi-brand owner. Only rendered when the
 * client_user attached to this client also has membership on >= 1 OTHER brand
 * (so the owner can flip between CBB + CLDA via tabs inside one intake form).
 *
 * Token is signed server-side and the URL passed in; this component is the
 * copy-to-clipboard UI + the "what is this" explanation aimed at val.
 */
import { useState } from 'react';

export default function OwnerIntakeLink({
  url,
  ownerName,
  brandCount
}: {
  url: string;
  ownerName: string;
  brandCount: number;
}) {
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
          All-brands intake link — for owners with multiple brands
        </div>
        <span className="text-[10px] text-muted/80 shrink-0" title="Token signed for this person; rejects after 30 days.">
          Expires in 30 days
        </span>
      </div>
      <p className="text-xs text-muted mb-2 leading-relaxed">
        Opens to a single intake page with a tab per brand. {ownerName} can fill {brandCount} brands&apos; intakes from
        this one link without juggling separate URLs.
        <span className="block mt-1 text-[color-mix(in_srgb,var(--gold-bright)_85%,transparent)]">
          ⚠ Send to {ownerName} only. Anyone with the URL can fill all {brandCount} brand intakes.
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
          className="shrink-0 rounded-lg border border-border bg-brand text-black font-medium text-sm px-4 py-2"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
