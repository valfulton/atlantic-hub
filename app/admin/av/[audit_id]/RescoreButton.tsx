'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Owner / staff override: force an AI re-score of this lead.
 * Calls POST /api/admin/av/leads/[audit_id]/score, then refreshes the
 * page so the new ai_score / ai_score_band / audit_content all render
 * fresh.
 *
 * Cosmetic note: this button uses the SHARED .ah-action-sparkle class
 * defined in app/globals.css. Every AI-powered action button in the app
 * (Generate outreach, Generate commercial, Generate social, etc.) should
 * use the same class so the sparkle aesthetic is consistent + so no
 * future session has to copy-paste this CSS. See docs/COSMETIC_BASELINE.md.
 */
export function RescoreButton({ auditId }: { auditId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data.skipReason || data.error || `HTTP ${res.status}`;
        setMsg(`Re-score failed: ${detail}`);
        return;
      }
      const score = data?.result?.aiScore;
      const band = data?.result?.aiScoreBand;
      setMsg(`Re-scored: ${score} (${band})`);
      // Refresh server components so the new score renders.
      router.refresh();
    } catch (err) {
      setMsg(`Network error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        data-loading={busy ? 'true' : 'false'}
        className="ah-action-sparkle px-3 py-1.5 rounded-md text-sm bg-surface border border-border hover:border-brand text-ink transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        title="Re-run AI scoring + audit for this lead"
        aria-label="Re-score this lead with AI"
      >
        <span className="ah-sparkle-icon" aria-hidden="true">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2z"
              fill="currentColor"
            />
          </svg>
        </span>
        <span>{busy ? 'Scoring' : 'Re-score'}</span>
        <span className="ah-sparkle-pair" aria-hidden="true">
          <span>✦</span>
          <span>✧</span>
        </span>
      </button>
      {msg && (
        <span className="text-xs text-muted" aria-live="polite">
          {msg}
        </span>
      )}
    </div>
  );
}
