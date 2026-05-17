'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Owner / staff override: force an AI re-score of this lead.
 * Calls POST /api/admin/av/leads/[audit_id]/score, then refreshes
 * the page so the new ai_score / ai_score_band / audit_content all
 * render fresh.
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
        className="px-3 py-1.5 rounded-md text-sm bg-surface border border-border hover:border-brand text-ink transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Re-run AI scoring + audit for this lead"
      >
        <span>{busy ? '...' : 'AI'}</span> {busy ? 'Scoring' : 'Re-score'}
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}
