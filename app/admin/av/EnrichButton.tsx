'use client';
import { useEffect, useState } from 'react';
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

  // (#310) Mirror BatchEnrichAllButton's selection wiring. When val checks
  // rows in AvLeadsTable, those audit_ids come over as a CustomEvent — we
  // send THEM to /enrich instead of letting the server auto-pick by AI score
  // and land on Coca-Cola / Rheem again. Empty selection = legacy behavior.
  const [selectedAuditIds, setSelectedAuditIds] = useState<string[]>([]);
  useEffect(() => {
    function onSelection(e: Event) {
      const detail = (e as CustomEvent<{ auditIds?: string[] }>).detail;
      setSelectedAuditIds(Array.isArray(detail?.auditIds) ? detail.auditIds : []);
    }
    window.addEventListener('av-leads-selection-change', onSelection);
    return () => window.removeEventListener('av-leads-selection-change', onSelection);
  }, []);

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
      // (#310) If val has rows checked, send THOSE audit_ids and use the
      // selection size as the cap (so "Enrich 3 selected" doesn't silently
      // pull 5). Otherwise legacy: server picks stalest defaultLimit.
      const usingSelection = selectedAuditIds.length > 0;
      const effectiveLimit = usingSelection
        ? Math.min(selectedAuditIds.length, 50)
        : defaultLimit;
      const body: Record<string, unknown> = { limit: effectiveLimit };
      if (usingSelection) body.auditIds = selectedAuditIds.slice(0, 50);
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
      // (#291) Mirror the all-sources batch pattern — tell AvLeadsTable
      // which audit_ids were just processed so it auto-deselects them and
      // marks the rows with ✨. We send the leadId-derived audit_ids when
      // available, else fall back to dispatching nothing. The current Hunter
      // result shape uses numeric leadId not audit_id, so we send what we
      // have via a parallel event the table also listens for.
      const justRanLeadIds = data.results.map((r) => r.leadId).filter((n): n is number => typeof n === 'number');
      if (justRanLeadIds.length > 0) {
        window.dispatchEvent(
          new CustomEvent('av-leads-just-enriched-by-id', { detail: { leadIds: justRanLeadIds } })
        );
      }
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
        className="text-sm px-3 py-1.5 bg-brand text-black rounded-md hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
        title={
          outOfCredits
            ? 'Monthly Hunter credits exhausted — top up your Hunter plan or wait for next month’s reset.'
            : selectedAuditIds.length > 0
            ? `Enrich the ${selectedAuditIds.length} lead${selectedAuditIds.length === 1 ? '' : 's'} you've checked. Uncheck all to fall back to "next ${defaultLimit} stalest."`
            : 'Find real names + emails for placeholder prospects. Picks follow each client’s Preferred / Excluded Contact Titles (set on the client’s ICP). Check rows in the table below to enrich those specific leads.'
        }
      >
        {running ? (
          <>
            <span className="inline-block w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin" />
            Enriching…
          </>
        ) : (
          <>
            {selectedAuditIds.length > 0
              ? `✨ Enrich ${selectedAuditIds.length} selected`
              : `✨ Enrich next ${defaultLimit}`}
            {badge && (
              <span
                className="text-[10px] font-medium"
                style={{
                  // (#293) Button is now amber/text-black per the white-on-yellow
                  // accessibility rule, so the badge needs dark variants too —
                  // pale red / pale yellow were illegible on amber.
                  color: outOfCredits ? '#7f1d1d' : lowCredits ? '#78350f' : 'rgba(0,0,0,0.65)'
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
  // (#291) Per-lead failure rows so val can see WHY a lead came back empty
  // (e.g. "invalid_domain", "rate_limited", "no contacts found"). Hidden
  // when there are no failures.
  const failureRows = summary.results.filter(
    (r) => r.outcome === 'no_results' || r.outcome === 'no_domain' || r.outcome === 'api_error'
  );
  const labelForOutcome = (r: EnrichmentResult): string => {
    const o = r.outcome;
    // (#308) When the enricher returns a no_results with a duplicate-email
    // explanation, surface the more specific "already in your pipeline" label
    // so it reads honestly. Hunter DID find the contact — we just couldn't
    // save it because dedup caught it.
    if (o === 'no_results' && r.details?.error && r.details.error.includes("already in your pipeline")) {
      return 'already in your pipeline';
    }
    if (o === 'no_domain') return 'no domain on file';
    if (o === 'no_results') return 'no Hunter contacts found';
    if (o === 'api_error') return 'Hunter API error';
    if (o === 'skipped_credit_cap') return 'skipped — credit cap';
    return o;
  };

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

        {failureRows.length > 0 && (
          <div className="mb-4">
            <div className="text-xs uppercase tracking-wider text-muted mb-2">
              Not enriched ({failureRows.length})
            </div>
            <ul className="space-y-1.5 max-h-48 overflow-y-auto">
              {failureRows.map((r) => (
                <li key={r.leadId} className="text-xs bg-bg border border-border rounded-md px-3 py-2">
                  <div className="font-medium text-ink">{r.company}</div>
                  <div className="text-muted">
                    <span style={{ color: '#FFB89A' }}>{labelForOutcome(r)}</span>
                    {r.details?.domain && <span> · {r.details.domain}</span>}
                    {r.details?.error && (
                      <span> · <span className="text-ink/70">{r.details.error}</span></span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bg-bg border border-border rounded-md px-3 py-2 mb-3 text-xs">
          <div className="text-muted">
            Enrichment credits this month:{' '}
            <span className="text-ink font-medium">
              {summary.creditsUsedThisMonth} / {summary.monthlyCeiling}
            </span>{' '}
            ({summary.creditsRemainingThisMonth} remaining)
          </div>
        </div>

        {/* (#292) Discoverability: tell val WHY these specific contacts were
            picked + where to change the lever. Without this she'd have no idea
            the ICP titles drive the contact picker. */}
        <div className="rounded-md border border-[#EBCB6B]/25 bg-[#EBCB6B]/5 px-3 py-2 mb-4 text-[11px] text-[#EBCB6B]/95/90 leading-relaxed">
          <span className="font-medium text-[#EBCB6B]/95">How these were picked:</span>{' '}
          Hunter follows each client&apos;s <span className="text-[#EBCB6B]">Preferred</span> and{' '}
          <span className="text-[#EBCB6B]">Excluded Contact Titles</span> (from their ICP). When a
          lead already has a name on file, we use Hunter&apos;s Email Finder to target THAT person
          directly instead of pulling the whole domain roster. To change the titles, open the
          client&apos;s page and edit the ICP — leads with no client attached fall back to
          Owner / Founder / CEO priority.
        </div>

        {summary.suggestedNextAction === 'send_outreach_email_series' && enrichedRows.length > 0 && (
          <div className="bg-[#EBCB6B]/8 border border-[#EBCB6B]/40 rounded-md px-3 py-3 mb-4 text-xs text-[#EBCB6B]/90">
            <div className="font-medium mb-1">📨 Send outreach to these {enrichedRows.length} leads?</div>
            <div>
              Cold-email orchestration is the next feature on the roadmap. For now this is a stub —
              clicking "Yes" below tells the system you want this functionality, and the next build
              session will wire the actual email-sending logic against the templates in{' '}
              <code className="bg-[#EBCB6B]/15 px-1 rounded">templates.md</code>.
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => alert('Noted! Email outreach orchestration is queued for the next build session.')}
                className="text-xs px-3 py-1.5 border border-[#EBCB6B]/45 text-[#EBCB6B] rounded-md hover:opacity-90"
              >
                Yes, queue outreach
              </button>
              <button
                onClick={onClose}
                className="text-xs px-3 py-1.5 border border-[#EBCB6B]/40 text-[#EBCB6B]/90 rounded-md hover:bg-[#EBCB6B]/15"
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
