'use client';

/**
 * PrepPreflightButton  (#358, val 2026-06-02)
 *
 * "Check first" — fires the free pre-flight (NO LLM calls), shows per-step
 * readiness so val knows what Prep will actually do before spending tokens.
 * If the URL is dead or the brief is too thin, this is the first place that
 * answer shows up — no charges incurred.
 *
 * Lives next to PrepAllButton. Same color tone (emerald = ok) but more
 * passive: this one's a diagnostic, not an action.
 */
import { useState } from 'react';
import { apiCall, ApiError } from '@/lib/http';

interface StepReadiness {
  ok: boolean;
  reason?: string;
}
interface PreflightReport {
  url: string | null;
  web: {
    reached: boolean;
    httpStatus: number | null;
    contentType: string | null;
    wordCount: number;
    failureReason: string | null;
  } | null;
  brief: {
    filledCount: number;
    enoughForLlm: boolean;
  };
  hasIntake: boolean;
  steps: {
    fill_intake: StepReadiness;
    brand_kit: StepReadiness;
    sharpen_icp: StepReadiness;
    extract_intel: StepReadiness;
    scrape_socials: StepReadiness;
  };
}

const STEP_LABEL: Record<string, string> = {
  fill_intake: 'Fill intake from web',
  brand_kit: 'Extract brand kit',
  sharpen_icp: 'Sharpen ICP',
  extract_intel: 'Extract intelligence',
  scrape_socials: 'Scrape socials (free)'
};

export default function PrepPreflightButton({ clientId }: { clientId: number }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const data = await apiCall<{ ok: boolean; report: PreflightReport }>(
        `/api/admin/av/clients/${clientId}/preflight`,
        {}
      );
      setReport(data.report);
    } catch (e) {
      setError(e instanceof ApiError ? `Check failed (HTTP ${e.status})` : 'Check failed.');
    } finally {
      setBusy(false);
    }
  }

  const willRun = report
    ? Object.values(report.steps).filter((s) => s.ok).length
    : 0;
  const willSkip = report
    ? Object.values(report.steps).filter((s) => !s.ok).length
    : 0;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Check first — free</div>
          <div className="text-sm text-ink mt-0.5">
            Pre-flight every step. No LLM calls, no charges. See what Prep WILL run before spending tokens.
          </div>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="shrink-0 rounded-lg border border-border bg-black/30 hover:bg-white/5 text-ink text-sm px-4 py-2 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Check readiness'}
        </button>
      </div>
      {error && <div className="text-xs text-danger mt-2">{error}</div>}
      {report && (
        <div className="mt-3 grid gap-2 text-xs">
          <div className="flex items-center gap-4 text-[11px] text-muted flex-wrap">
            <span><span className="text-emerald-300">{willRun}</span> step{willRun === 1 ? '' : 's'} ready</span>
            <span><span className="text-[var(--gold-bright)]">{willSkip}</span> would skip</span>
            {report.url ? (
              <span>website {report.url} → {report.web?.reached
                ? <span className="text-emerald-300">HTTP {report.web.httpStatus} · {report.web.wordCount} words</span>
                : <span className="text-danger">{report.web?.failureReason ?? 'unreachable'}</span>}</span>
            ) : <span className="text-muted">no website on brief</span>}
            <span>brief: <span className={report.brief.enoughForLlm ? 'text-emerald-300' : 'text-[var(--gold-bright)]'}>{report.brief.filledCount} field{report.brief.filledCount === 1 ? '' : 's'} filled</span></span>
          </div>
          <ul className="grid gap-1 mt-1">
            {Object.entries(report.steps).map(([key, s]) => (
              <li key={key} className="flex items-start gap-2">
                <span aria-hidden className={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${s.ok ? 'bg-emerald-400' : 'bg-[var(--gold-bright)]'}`} />
                <span className="text-ink/90 shrink-0">{STEP_LABEL[key] ?? key}</span>
                <span className={s.ok ? 'text-emerald-300' : 'text-[color-mix(in_srgb,var(--gold-bright)_95%,transparent)]/85'}>
                  {s.ok ? '— ready' : `— would skip: ${s.reason ?? 'not ready'}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
