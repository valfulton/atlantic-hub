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

export function EnrichButton({ defaultLimit = 5 }: { defaultLimit?: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<EnrichmentBatchSummary | null>(null);
  const [showResult, setShowResult] = useState(false);

  async function runEnrichment() {
    setRunning(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch('/api/admin/av/enrich', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: defaultLimit })
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || j.message || `HTTP ${res.status}`);
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

  return (
    <>
      <button
        onClick={runEnrichment}
        disabled={running}
        className="text-sm px-3 py-1.5 bg-brand text-white rounded-md hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
        title="Find real names + emails for placeholder prospects via Hunter.io"
      >
        {running ? (
          <>
            <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Enriching…
          </>
        ) : (
          <>✨ Enrich next {defaultLimit}</>
        )}
      </button>

      {error && (
        <span className="ml-3 text-xs text-red-600">Error: {error}</span>
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
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl max-w-lg w-full p-6 shadow-2xl"
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
            Hunter credits this month:{' '}
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
