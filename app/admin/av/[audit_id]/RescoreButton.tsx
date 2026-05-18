'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Owner / staff override: force an AI re-score of this lead.
 * Calls POST /api/admin/av/leads/[audit_id]/score, then refreshes
 * the page so the new ai_score / ai_score_band / audit_content all
 * render fresh.
 *
 * The button borrows the sparkle aesthetic from the pop-journey page on
 * atlanticandvine.netlify.app -- the same brand language used to make the
 * client onboarding flow feel alive. Sparkles twinkle on hover; the busy
 * state replaces the leading icon with a sparkle-spinner so the moment
 * something AI-driven is happening, the operator gets a small "yep, the
 * platform is working" cue.
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
        className="ah-rescore group relative px-3 py-1.5 rounded-md text-sm bg-surface border border-border hover:border-brand text-ink transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed overflow-visible"
        title="Re-run AI scoring + audit for this lead"
      >
        <span className="ah-rescore-icon" aria-hidden="true">
          {busy ? (
            <svg
              className="ah-rescore-spinner"
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
          ) : (
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
          )}
        </span>
        <span>{busy ? 'Scoring' : 'Re-score'}</span>
        {/* Twin sparkles -- appear on hover via pseudo-elements (in <style> block) */}
        <span className="ah-sparkle ah-sparkle-1" aria-hidden="true">✦</span>
        <span className="ah-sparkle ah-sparkle-2" aria-hidden="true">✧</span>
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}

      <style jsx>{`
        .ah-rescore {
          position: relative;
        }
        .ah-rescore-icon {
          display: inline-flex;
          color: var(--brand);
          opacity: 0.85;
          transition: opacity 200ms ease, transform 200ms ease;
        }
        .ah-rescore:hover .ah-rescore-icon {
          opacity: 1;
          transform: scale(1.1);
        }
        .ah-rescore-spinner {
          animation: ah-spin 1.1s linear infinite;
          color: var(--brand);
        }
        @keyframes ah-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .ah-sparkle {
          position: absolute;
          font-size: 9px;
          color: var(--brand);
          opacity: 0;
          pointer-events: none;
          transition: opacity 200ms ease;
          text-shadow: 0 0 6px var(--brand-glow, rgba(245,158,11,0.55));
        }
        .ah-sparkle-1 {
          top: -4px;
          right: -2px;
          animation: ah-twinkle 1.8s ease-in-out infinite;
        }
        .ah-sparkle-2 {
          bottom: -2px;
          right: 14px;
          animation: ah-twinkle 1.8s ease-in-out infinite;
          animation-delay: 0.5s;
        }
        .ah-rescore:hover .ah-sparkle,
        .ah-rescore:focus-visible .ah-sparkle {
          opacity: 1;
        }
        @keyframes ah-twinkle {
          0%, 100% { transform: scale(0.6) rotate(0deg); opacity: 0.3; }
          50%      { transform: scale(1.2) rotate(20deg); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
