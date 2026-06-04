'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * "Coach next N calls" button.
 *
 * One-click run of the pain-extractor sweep against the top-scored
 * leads. Each successful run writes a structured pain_point_profile
 * to the lead row, which then renders as the gold "what to say on the
 * call" callout on the lead detail page. Same auth as the rest of the
 * dashboard -- uses the admin cookie, no terminal needed.
 *
 * Sales-team framing: this button is what you press when you add a
 * batch of prospects at noon and want your reps to be coached on them
 * before they start dialing. No engineering jargon in the UI.
 */

interface CoachResult {
  ok: boolean;
  attempted: number;
  extracted: number;
  skipped: number;
  failed: number;
  stoppedEarly: boolean;
  elapsedMs: number;
}

export function CoachCallsButton({ defaultLimit = 25 }: { defaultLimit?: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CoachResult | null>(null);
  const [showResult, setShowResult] = useState(false);

  async function runCoach() {
    setRunning(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch('/api/admin/av/pain-sweep', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: defaultLimit })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || j.message || `HTTP ${res.status}`);
      }
      const data: CoachResult = await res.json();
      setSummary(data);
      setShowResult(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={runCoach}
        disabled={running}
        data-loading={running ? 'true' : 'false'}
        className="ah-action-sparkle text-sm px-3 py-1.5 bg-brand text-black rounded-md hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        title={`Read your top ${defaultLimit} leads and write a 'what to say on the call' cheat sheet for each. AI does it in under a minute. Reps get instant call coaching.`}
        aria-label={`Coach next ${defaultLimit} calls -- AI builds call cheat sheets for your top leads`}
      >
        <span className="ah-sparkle-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2z"
              fill="currentColor"
            />
          </svg>
        </span>
        <span>{running ? 'Coaching...' : `Coach next ${defaultLimit} calls`}</span>
        <span className="ah-sparkle-pair" aria-hidden="true">
          <span>✦</span>
          <span>✧</span>
        </span>
      </button>

      {error && (
        <span className="ml-3 text-xs text-rose-300" aria-live="polite">
          Error: {error}
        </span>
      )}

      {showResult && summary && (
        <ResultModal summary={summary} onClose={() => setShowResult(false)} />
      )}
    </>
  );
}

function ResultModal({
  summary,
  onClose
}: {
  summary: CoachResult;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="border border-border rounded-xl max-w-md w-full p-6 shadow-2xl"
        style={{ backgroundColor: '#0e1420' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">
          {summary.extracted > 0 ? 'Call sheets ready' : 'Nothing new to coach'}
        </h2>
        <p className="text-sm text-muted mb-4">
          {summary.attempted === 0
            ? 'No leads needed fresh coaching. Existing cheat sheets are still current (refreshed within the last 14 days).'
            : `Read ${summary.attempted} leads in ${Math.round(summary.elapsedMs / 1000)}s. Each one now has a "what to say on the call" callout on its detail page.`}
        </p>

        <div className="grid grid-cols-3 gap-2 text-sm mb-4">
          <Stat label="Coached" value={summary.extracted} tone="success" />
          <Stat label="Skipped" value={summary.skipped} />
          <Stat label="Failed" value={summary.failed} tone={summary.failed > 0 ? 'warn' : undefined} />
        </div>

        {summary.stoppedEarly && (
          <div className="bg-[#EBCB6B]/10 border border-[#EBCB6B]/40 rounded-md px-3 py-2 mb-4 text-xs text-[#EBCB6B]/95">
            Run stopped early to avoid timeout. Click again to coach the rest.
          </div>
        )}

        <p className="text-xs text-muted mb-4">
          Click into any lead with a coached callout and you will see the primary
          pain, urgency, conversation starters, and what to avoid saying. Your reps
          should open this on their phones before dialing.
        </p>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-4 py-2 bg-surface border border-border rounded-md hover:border-ink"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone?: 'success' | 'warn';
}) {
  const color =
    tone === 'success' && value > 0
      ? 'text-emerald-300'
      : tone === 'warn' && value > 0
      ? 'text-rose-300'
      : 'text-ink';
  return (
    <div className="bg-surface border border-border rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
