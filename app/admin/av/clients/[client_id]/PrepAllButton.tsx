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

interface StepResult {
  step: string;
  status: 'ok' | 'skipped' | 'failed';
  detail?: string;
}

interface PrepResponse {
  ok: boolean;
  websiteUrl: string | null;
  okCount: number;
  failedCount: number;
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
  failed: 'text-danger'
};
const STATUS_DOT: Record<StepResult['status'], string> = {
  ok: 'bg-emerald-400',
  skipped: 'bg-muted/50',
  failed: 'bg-red-400'
};

export default function PrepAllButton({ clientId, clientName }: { clientId: number; clientName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PrepResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!confirm(`Run the full prep chain for ${clientName}? This fills blanks only — anything you typed stays.`)) return;
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
          <div className="text-[11px] text-muted">
            {result.okCount} succeeded · {result.failedCount} failed
            {result.websiteUrl ? <> · website <span className="text-ink">{result.websiteUrl}</span></> : null}
          </div>
          <ul className="grid gap-1">
            {result.results.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px]">
                <span aria-hidden className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${STATUS_DOT[r.status]}`} />
                <span className="text-ink/90 shrink-0">{STEP_LABEL[r.step] ?? r.step}</span>
                <span className={`${STATUS_COLOR[r.status]} truncate`}>
                  {r.status === 'ok' ? '— ' : r.status === 'failed' ? '— failed: ' : '— '}
                  {r.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
