'use client';

/**
 * IcpFitScorePanel  (#95)
 *
 * Operator-side button on the client page: "Score this client's leads
 * against their ICP." Runs scoreClientLeadsBulk via the API, surfaces a
 * compact result line, and refreshes the page so the new fit pills appear
 * on each lead card.
 *
 * Each lead = one OpenAI call. The endpoint hard-deadlines at 55s and
 * returns whatever was scored, so val never hits a 504. For very large
 * pipelines she can click again to score the next batch.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ScoreResult {
  ok: true;
  attempted: number;
  scored: number;
  skipped: number;
  failed: number;
}

export default function IcpFitScorePanel({
  clientId,
  clientName
}: {
  clientId: number;
  clientName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'idle' | 'unscored' | 'all'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ScoreResult | null>(null);

  async function run(mode: 'unscored' | 'all') {
    setBusy(mode);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/score-icp-fit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, limit: 100 })
      });
      const raw = await res.text();
      let data: ScoreResult | { error?: string; detail?: string } | null = null;
      try { data = JSON.parse(raw); } catch { throw new Error(`HTTP ${res.status} (non-JSON)`); }
      if (!res.ok || !data || !('ok' in data)) {
        const detail = data && 'detail' in data ? data.detail : null;
        throw new Error((data && 'error' in data && data.error) || detail || `HTTP ${res.status}`);
      }
      setResult(data);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-1">
        ICP fit score
      </div>
      <div className="text-[12.5px] text-white/70 mb-3 leading-relaxed">
        Rate every lead in {clientName}&apos;s pipeline 0-100 on how well it fits THEIR
        ICP and brief — not a generic audit score. Surfaces as a fit pill on each lead
        card + a one-sentence reason. Use after you load new leads or update their brief.
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => run('unscored')}
          disabled={busy !== 'idle'}
          className={
            'rounded-md px-3 py-1.5 text-[11.5px] font-medium transition ' +
            (busy !== 'idle'
              ? 'bg-white/10 text-white/40 cursor-not-allowed'
              : 'bg-amber-400/90 text-black hover:bg-amber-300')
          }
        >
          {busy === 'unscored' ? 'Scoring…' : 'Score unscored leads'}
        </button>
        <button
          onClick={() => run('all')}
          disabled={busy !== 'idle'}
          className={
            'rounded-md px-3 py-1.5 text-[11.5px] font-medium transition border ' +
            (busy !== 'idle'
              ? 'bg-white/10 text-white/40 border-white/10 cursor-not-allowed'
              : 'bg-transparent text-white/75 border-white/15 hover:text-white hover:border-white/30')
          }
        >
          {busy === 'all' ? 'Rescoring…' : 'Rescore all'}
        </button>
        <span className="text-[10.5px] text-white/40">
          One LLM call per lead · runs in batches of 100 · ~55s ceiling per click.
        </span>
      </div>

      {err && <div className="text-[10.5px] text-rose-300 mt-2">{err}</div>}
      {result && (
        <div className="mt-2 text-[11.5px] text-emerald-200">
          Scored {result.scored} of {result.attempted}.
          {result.skipped > 0 && (
            <span className="text-white/55">
              {' '}
              ({result.skipped} skipped — either no brief, no signal, or already current.)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
