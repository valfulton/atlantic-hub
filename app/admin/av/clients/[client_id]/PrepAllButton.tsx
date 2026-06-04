'use client';

/**
 * PrepAllButton  (#353, val 2026-06-02)
 *
 * One-click "light up the strip" for a client. Calls /prep-all which chains
 * fill-intake + brand-kit + sharpen-ICP + extract-intel + scrape-socials. Shows
 * per-step results as they come back so val can SEE what happened (vs a silent
 * autopilot run). After completion, refreshes the page so the StageStrip
 * re-computes from the new state.
 *
 * Designed for the Adriana demo workflow: open her client page, hit this button,
 * watch ~5 chips turn green in 30-60 seconds. Then send the intake link with
 * the portfolio already populated.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiCall, ApiError } from '@/lib/http';
import { CostBadge } from '@/app/_components/CostBadge';

interface StepResult {
  step: string;
  status: 'ok' | 'skipped' | 'failed' | 'pre_skipped';
  detail?: string;
  /** (#367) Per-step cost — fanned out of llm_call_log post-run. */
  costMicrocents?: number;
  costSource?: 'live' | 'cache' | null;
}

interface PrepResponse {
  ok: boolean;
  websiteUrl: string | null;
  okCount: number;
  failedCount: number;
  preSkippedCount?: number;
  totalCostMicrocents?: number;
  liveCallCount?: number;
  cacheHitCount?: number;
  results: StepResult[];
}

const STEP_LABEL: Record<string, string> = {
  fill_intake: 'Fill intake from web',
  brand_kit: 'Extract brand kit',
  sharpen_icp: 'Sharpen ICP',
  extract_intel: 'Extract intelligence',
  narrative_lines: 'Propose campaigns',
  socials_scrape: 'Scrape socials'
};

const STATUS_COLOR: Record<StepResult['status'], string> = {
  ok: 'text-emerald-300',
  skipped: 'text-muted',
  pre_skipped: 'text-[#EBCB6B]/95/85',
  failed: 'text-danger'
};
const STATUS_DOT: Record<StepResult['status'], string> = {
  ok: 'bg-emerald-400',
  skipped: 'bg-muted/50',
  pre_skipped: 'bg-[#EBCB6B]',
  failed: 'bg-red-400'
};
const STATUS_PREFIX: Record<StepResult['status'], string> = {
  ok: '— ',
  skipped: '— ',
  pre_skipped: '— pre-skipped (no LLM fired): ',
  failed: '— failed: '
};

export default function PrepAllButton({
  clientId,
  clientName,
  briefFilledCount = '0'
}: {
  clientId: number;
  clientName: string;
  /** First-segment of stage 3's detail (e.g. "3" from "3 / 51") so we can
   *  warn before burning LLM calls on a near-empty brief. */
  briefFilledCount?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PrepResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const filled = parseInt(briefFilledCount, 10) || 0;
    const sparse = filled < 3;
    const base = `Run the full prep chain for ${clientName}?\n\nThis fires ~5 LLM calls (cents per run) and fills blanks only — anything you typed stays.`;
    const msg = sparse
      ? `${base}\n\n⚠ Heads up: their brief is sparse (${filled} field${filled === 1 ? '' : 's'} filled). The LLM steps will run on thin signal — output will be vague. Consider typing in their company name + industry first.\n\nProceed anyway?`
      : `${base}\n\nContinue?`;
    if (!confirm(msg)) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await apiCall<PrepResponse>(
        `/api/admin/av/clients/${clientId}/prep-all`,
        {}
      );
      setResult(data);
      // Refresh server-component data so the StageStrip re-computes.
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? `Failed (HTTP ${e.status})` : 'Failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.05] p-4 mb-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-300">Quick prep — one click</div>
          <div className="text-sm text-ink mt-0.5">
            Fill intake from web → brand kit → sharpen ICP → extract intelligence → pull socials. Blanks only, so anything you typed stays.
          </div>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="shrink-0 rounded-lg border border-emerald-400/50 bg-emerald-400/15 hover:bg-emerald-400/25 text-emerald-100 font-medium text-sm px-4 py-2 disabled:opacity-50"
        >
          {busy ? 'Running…' : `Prep ${clientName}`}
        </button>
      </div>
      {error && <div className="text-xs text-danger mt-2">{error}</div>}
      {result && (
        <div className="mt-3 grid gap-1.5">
          <div className="text-[11px] text-muted flex items-center gap-2 flex-wrap">
            <span>{result.okCount} succeeded · {result.failedCount} failed</span>
            {typeof result.preSkippedCount === 'number' && result.preSkippedCount > 0 && (
              <span className="text-[#EBCB6B]">· {result.preSkippedCount} pre-skipped (LLM not fired)</span>
            )}
            {/* (#361) Total cost for this run — auto-hidden under Presentation Mode. */}
            {typeof result.totalCostMicrocents === 'number' && (
              <span className="inline-flex items-center gap-1.5">
                · spent <CostBadge microcents={result.totalCostMicrocents} />
                {result.liveCallCount ? <span>· {result.liveCallCount} live</span> : null}
                {result.cacheHitCount ? <span className="text-emerald-300">· {result.cacheHitCount} cache hit{result.cacheHitCount === 1 ? '' : 's'}</span> : null}
              </span>
            )}
            {result.websiteUrl ? <span>· website <span className="text-ink">{result.websiteUrl}</span></span> : null}
          </div>
          <ul className="grid gap-1">
            {result.results.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px]">
                <span aria-hidden className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${STATUS_DOT[r.status]}`} />
                <span className="text-ink/90 shrink-0">{STEP_LABEL[r.step] ?? r.step}</span>
                <span className={`${STATUS_COLOR[r.status]} truncate flex-1`}>
                  {STATUS_PREFIX[r.status]}
                  {r.detail}
                </span>
                {/* (#367) Per-step cost — hidden under Presentation Mode via CostBadge.
                    Only shows for LLM steps that actually ran (live or cache). */}
                {r.costSource === 'live' && typeof r.costMicrocents === 'number' && (
                  <span className="shrink-0">
                    <CostBadge microcents={r.costMicrocents} />
                  </span>
                )}
                {r.costSource === 'cache' && (
                  <span className="shrink-0 text-[10px] text-emerald-300 uppercase tracking-wider">cache</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
