'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface EnrichmentResult {
  leadId: number;
  company: string;
  outcome: 'enriched' | 'no_domain' | 'no_results' | 'api_error' | 'skipped_credit_cap';
  details?: {
    newEmail?: string;
    newName?: string;
    newTitle?: string;
    domain?: string;
    error?: string;
  };
}

interface EnrichmentBatchSummary {
  attempted: number;
  enriched: number;
  noResults: number;
  noDomain: number;
  apiErrors: number;
  creditsUsedThisRun: number;
  creditsUsedThisMonth: number;
  creditsRemainingThisMonth: number;
  monthlyCeiling: number;
  results: EnrichmentResult[];
  stoppedEarlyReason: string | null;
  suggestedNextAction: 'send_outreach_email_series' | 'review_results' | null;
}

/**
 * (#250) Map an HTTP status + server error string into operator-honest copy.
 * The previous code rendered raw `error: unauthorized` for both expired
 * sessions and cap-rejected runs, which made it impossible to tell what
 * actually happened. This translates the two real causes into the language
 * val can act on.
 */
function honestError(status: number, raw: string | null): string {
  if (status === 401) return 'Session expired — reload the page and log in again.';
  if (status === 403) return 'Not permitted — only owner / staff can run enrichment.';
  if (status === 429) return 'Slow down — too many requests in a row. Try again in a minute.';
  if (raw === 'av tab disabled') return 'The AV tab is disabled in feature flags.';
  if (raw && /cap|ceiling|credit/i.test(raw)) return raw; // server-side cap copy passes through unchanged
  if (raw) return raw;
  return `HTTP ${status}`;
}

export function EnrichButton({
  defaultLimit = 5,
  creditsRemaining,
  monthlyCeiling,
  isOwner = false
}: {
  defaultLimit?: number;
  /** Credits left this month — drives the inline badge so val never has to guess. */
  creditsRemaining?: number;
  /** This month's cap — used to bound the owner "raise ceiling" override. */
  monthlyCeiling?: number;
  /** When true, surface the owner-only "raise ceiling for this batch" form. */
  isOwner?: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<EnrichmentBatchSummary | null>(null);
  const [showResult, setShowResult] = useState(false);
  // (#250) Owner-only ceiling override input. Only sent when isOwner + non-empty.
  const [showRaise, setShowRaise] = useState(false);
  const [raiseTo, setRaiseTo] = useState<string>('');

  const lowCredits =
    typeof creditsRemaining === 'number' && typeof monthlyCeiling === 'number' &&
    monthlyCeiling > 0 && creditsRemaining <= Math.max(5, Math.round(monthlyCeiling * 0.15));
  const outOfCredits =
    typeof creditsRemaining === 'number' && creditsRemaining <= 0;

  async function runEnrichment() {
    setRunning(true);
    setError(null);
    setSummary(null);
    try {
      const body: Record<string, unknown> = { limit: defaultLimit };
      // (#250) Owner-only override — only honored server-side when the actor
      // role is 'owner'. Sending it as non-owner is a no-op.
      if (isOwner && showRaise) {
        const n = Number(raiseTo);
        if (Number.isFinite(n) && n > 0 && n <= 1000) {
          body.monthlyCeilingOverride = Math.floor(n);
        }
      }
      const res = await fetch('/api/admin/av/enrich', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const raw: string | null = j.error || j.message || null;
        throw new Error(honestError(res.status, raw));
      }
      const data: EnrichmentBatchSummary = await res.json();
      setSummary(data);
      setShowResult(true);
      // Refresh the page to pick up newly enriched leads (the server component
      // re-renders with fresh data from the DB)
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  // (#250) Badge text — "Enrich next 5 · 14 left" so val sees status inline.
  const badge =
    typeof creditsRemaining === 'number'
      ? ` · ${creditsRemaining} left`
      : '';

  return (
    <>
      <button
        onClick={runEnrichment}
        disabled={running || outOfCredits}
        className="text-sm px-3 py-1.5 bg-brand text-white rounded-md hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
        title={
          outOfCredits
            ? 'Monthly Hunter credits exhausted — top up your Hunter plan or wait for next month’s reset.'
            : 'Find real names + emails for placeholder prospects'
        }
      >
        {running ? (
          <>
            <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Enriching…
          </>
        ) : (
          <>
            ✨ Enrich next {defaultLimit}
            {badge && (
              <span
                className="text-[10px] font-medium"
                style={{
                  color: outOfCredits ? '#fecaca' : lowCredits ? '#fde68a' : 'rgba(255,255,255,0.85)'
                }}
              >
                {badge}
              </span>
            )}
          </>
        )}
      </button>

      {/* (#250) Owner-only ceiling override toggle. Kept inline + dismissable
          so it doesn't clutter the page for non-owners or when val isn't
          actively pushing past the soft cap. */}
      {isOwner && !running && !outOfCredits && (
        <span className="ml-2 inline-flex items-center gap-1.5 text-[11px] text-muted">
          {!showRaise ? (
            <button
              type="button"
              onClick={() => setShowRaise(true)}
              className="underline-offset-2 hover:underline"
              title="Owner override — temporarily raise the monthly cap for THIS batch only."
            >
              raise ceiling
            </button>
          ) : (
            <>
              <span>raise to</span>
              <input
                type="number"
                min={1}
                max={1000}
                value={raiseTo}
                onChange={(e) => setRaiseTo(e.target.value)}
                placeholder={monthlyCeiling ? String(monthlyCeiling) : '100'}
                className="w-16 px-1.5 py-0.5 text-[11px] bg-black/30 border border-white/15 rounded text-ink"
              />
              <button
                type="button"
                onClick={() => { setShowRaise(false); setRaiseTo(''); }}
                className="text-muted hover:text-ink"
              >
                cancel
              </button>
            </>
          )}
        </span>
      )}

      {error && (
        <span className="ml-3 text-xs" style={{ color: '#fca5a5' }}>{error}</span>
      )}

      {showResult && summary && (
        <ResultModal
          summary={summary}
          onClose={() => setShowResult(false)}
        />
      )}
    </>
  );
}

function ResultModal({
  summary,
  onClose
}: {
  summary: EnrichmentBatchSummary;
  onClose: () => void;
}) {
  const enrichedRows = summary.results.filter((r) => r.outcome === 'enriched');

  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="border border-border rounded-xl max-w-lg w-full p-6 shadow-2xl"
        style={{ backgroundColor: '#0e1420' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">Enrichment complete ✨</h2>
        <p className="text-sm text-muted mb-4">
          {summary.attempted === 0
            ? summary.stoppedEarlyReason || 'No eligible leads found.'
            : `Attempted ${summary.attempted} · enriched ${summary.enriched}`}
        </p>

        <div className="grid grid-cols-2 gap-2 text-sm mb-4">
          <Stat label="Enriched" value={summary.enriched} tone="success" />
          <Stat label="No results" value={summary.noResults} />
          <Stat label="No domain" value={summary.noDomain} />
          <Stat label="API errors" value={summary.apiErrors} />
        </div>

        {enrichedRows.length > 0 && (
          <div className="mb-4">
            <div className="text-xs uppercase tracking-wider text-muted mb-2">Newly enriched</div>
            <ul className="space-y-1.5 max-h-48 overflow-y-auto">
              {enrichedRows.map((r) => (
                <li key={r.leadId} className="text-xs bg-bg border border-border rounded-md px-3 py-2">
                  <div className="font-medium text-ink">{r.company}</div>
                  <div className="text-muted">
                    {r.details?.newName && <span>{r.details.newName}</span>}
                    {r.details?.newTitle && <span> · {r.details.newTitle}</span>}
                    {r.details?.newEmail && <span> · {r.details.newEmail}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-bg border border-border rounded-md px-3 py-2 mb-4 text-xs">
          <div className="text-muted">
            Enrichment credits this month:{' '}
            <span className="text-ink font-medium">
              {summary.creditsUsedThisMonth} / {summary.monthlyCeiling}
            </span>{' '}
            ({summary.creditsRemainingThisMonth} remaining)
          </div>
        </div>

        {summary.suggestedNextAction === 'send_outreach_email_series' && enrichedRows.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-3 mb-4 text-xs text-amber-900">
            <div className="font-medium mb-1">📨 Send outreach to these {enrichedRows.length} leads?</div>
            <div>
              Cold-email orchestration is the next feature on the roadmap. For now this is a stub —
              clicking "Yes" below tells the system you want this functionality, and the next build
              session will wire the actual email-sending logic against the templates in{' '}
              <code className="bg-amber-100 px-1 rounded">templates.md</code>.
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => alert('Noted! Email outreach orchestration is queued for the next build session.')}
                className="text-xs px-3 py-1.5 bg-amber-700 text-white rounded-md hover:opacity-90"
              >
                Yes, queue outreach
              </button>
              <button
                onClick={onClose}
                className="text-xs px-3 py-1.5 border border-amber-300 text-amber-900 rounded-md hover:bg-amber-100"
              >
                Not now
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <button
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
  tone?: 'success';
}) {
  const valueColor = tone === 'success' && value > 0 ? 'text-green-700' : 'text-ink';
  return (
    <div className="bg-bg border border-border rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-xl font-semibold ${valueColor}`}>{value}</div>
    </div>
  );
}
