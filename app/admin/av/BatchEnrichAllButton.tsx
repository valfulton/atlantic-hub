'use client';

/**
 * BatchEnrichAllButton  (#278)
 *
 * The bulk version of the per-lead Enrich-from-sources menu. Lives on
 * /admin/av next to the existing Hunter "Enrich next 5" button.
 *
 * Click → POSTs /api/admin/av/leads/batch-enrich-all with the chosen
 * batch size (5 / 10 / 25). The endpoint runs Smart enrich, Google Places,
 * Instagram, and WHOIS on the next N stalest active leads, sequentially.
 *
 * After the run, a result panel shows per-source fill totals + per-lead
 * row outcomes so val can see exactly what each lead got. No silent
 * "complete ✨" — val should never have to wonder where data landed.
 *
 * Deliberately NOT included: Hunter. Hunter has its own button and bills
 * credits per call; val burned 2 credits earlier for zero results so this
 * button avoids it entirely. Smart enrich is the LLM scraper (cheap-ish,
 * reads website), Places is Google Maps, IG is Apify, WHOIS is RDAP.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type SourceKey = 'smart' | 'places' | 'instagram' | 'whois';

interface SourceMeta {
  key: SourceKey;
  label: string;
  color: string;
}
const SOURCE_META: SourceMeta[] = [
  { key: 'smart',     label: 'Smart enrich',  color: '#fbbf24' },
  { key: 'places',    label: 'Google Places', color: '#4ade80' },
  { key: 'instagram', label: 'Instagram',     color: '#f472b6' },
  { key: 'whois',     label: 'WHOIS',         color: '#a78bfa' }
];

interface PerLeadOutcome {
  leadId: number;
  auditId: string;
  company: string | null;
  smart?: { filled: number; reason: string | null };
  places?: { filled: number; reason: string | null };
  instagram?: { filled: number; reason: string | null };
  whois?: { filled: number; reason: string | null };
}

interface BatchSummary {
  ok: true;
  leadsProcessed: number;
  leadsRequested: number;
  /** (#280) Non-null when the function bailed early to avoid the Netlify
   *  60s timeout. Tells val to click again to continue with the rest. */
  stoppedEarlyReason: string | null;
  elapsedMs: number;
  sourcesRun: SourceKey[];
  perSource: Record<SourceKey, { attempted: number; filled: number; errored: number }>;
  perLead: PerLeadOutcome[];
}

export function BatchEnrichAllButton({
  visibleLeadAuditIds = []
}: {
  /** (#279) audit_ids of the leads currently shown by the cockpit table.
   *  When non-empty, the batch enriches the FIRST `limit` of these — so
   *  val gets exactly the leads she's looking at, respecting her filter.
   *  When empty (or undefined), the server falls back to "stalest N"
   *  auto-pick across the whole pipeline. */
  visibleLeadAuditIds?: string[];
}) {
  const router = useRouter();
  // (#280 v2) Default 3 not 5 — Netlify's function timeout on val's plan
  // is tighter than the 60s I'd requested via maxDuration, so 5-lead batches
  // were 504'ing. 3 leads × 7s per source parallel = ~21s, fits any plan.
  // She can still bump to 5/10/25 via the dropdown when she wants to push.
  const [limit, setLimit] = useState<3 | 5 | 10 | 25>(3);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [showResult, setShowResult] = useState(false);

  // Slice to the first `limit` audit_ids — the leads the operator sees
  // at the top of her filtered table. Empty array signals "use auto-pick."
  const targetAuditIds = visibleLeadAuditIds.slice(0, limit);
  const usingVisible = targetAuditIds.length > 0;

  async function run() {
    setRunning(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch('/api/admin/av/leads/batch-enrich-all', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          limit,
          // Only send auditIds when we actually have some; the server treats
          // an empty/missing array as "use the stalest-N auto-pick path."
          ...(usingVisible ? { auditIds: targetAuditIds } : {})
        })
      });
      if (!res.ok) {
        // (#280 polish) Server now returns { error, message, errorClass }
        // for unexpected throws. Show val the actual server-side message
        // instead of bare HTTP 500 so she can tell us what failed.
        const j = await res.json().catch(() => ({}));
        const errBody = j as { error?: string; message?: string };
        const raw = errBody.message || errBody.error || `HTTP ${res.status}`;
        throw new Error(raw);
      }
      const data = (await res.json()) as BatchSummary;
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
      <div className="inline-flex items-center gap-2">
        <button
          onClick={run}
          disabled={running}
          className="text-sm px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 border bg-amber-400/10 text-amber-100 border-amber-400/40 hover:border-amber-400/70 disabled:opacity-50 transition"
          title={
            usingVisible
              ? `Run Smart enrich + Places + Instagram + WHOIS on the FIRST ${limit} leads currently visible in your filtered table. Hunter is NOT included — use the Hunter button separately.`
              : 'Run Smart enrich + Places + Instagram + WHOIS on the next N stalest active leads. Hunter is NOT included — use the Hunter button separately.'
          }
        >
          {running ? (
            <>
              <span className="inline-block w-3 h-3 border-2 border-amber-200 border-t-transparent rounded-full animate-spin" />
              Enriching {limit}…
            </>
          ) : (
            <>
              ✨ Enrich {usingVisible ? 'these' : 'next'} {limit} (all sources)
            </>
          )}
        </button>
        {!running && (
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) as 3 | 5 | 10 | 25)}
            className="text-sm bg-black/30 border border-white/15 text-ink rounded-md px-2 py-1.5 outline-none"
            aria-label="Batch size"
            title="Default 3 — fits Netlify's function timeout reliably. 5/10/25 may stop early under timeout and need a follow-up click."
          >
            <option value={3}>3</option>
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={25}>25</option>
          </select>
        )}
        {error && (
          <span className="ml-3 text-sm" style={{ color: '#fca5a5' }}>{error}</span>
        )}
      </div>

      {showResult && summary && (
        <ResultPanel summary={summary} onClose={() => setShowResult(false)} />
      )}
    </>
  );
}

function ResultPanel({ summary, onClose }: { summary: BatchSummary; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="border border-border rounded-xl max-w-3xl w-full p-6 shadow-2xl"
        style={{ backgroundColor: '#0e1420' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-ink mb-1">Batch enrichment done</h2>
        <p className="text-sm text-muted mb-2">
          {summary.leadsProcessed} of {summary.leadsRequested} {summary.leadsRequested === 1 ? 'lead' : 'leads'} processed across {summary.sourcesRun.length} sources in {Math.round(summary.elapsedMs / 100) / 10}s.
        </p>
        {summary.stoppedEarlyReason && (
          <p className="text-sm mb-5 px-3 py-2 rounded-md border border-amber-400/40 bg-amber-400/10 text-amber-100">
            {summary.stoppedEarlyReason}
          </p>
        )}
        {!summary.stoppedEarlyReason && <div className="mb-5" />}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {SOURCE_META.map((s) => {
            const counts = summary.perSource[s.key];
            return (
              <div
                key={s.key}
                className="rounded-lg border p-3"
                style={{ borderColor: `${s.color}66`, background: `${s.color}11` }}
              >
                <div className="text-sm font-medium" style={{ color: s.color }}>{s.label}</div>
                <div className="mt-1 text-2xl font-semibold text-ink">{counts.filled}</div>
                <div className="text-sm text-muted">fields filled</div>
                <div className="mt-1 text-xs text-muted">
                  ran {counts.attempted} · skipped/failed {counts.errored}
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-sm font-medium text-muted uppercase tracking-wide mb-2">Per lead</div>
        <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {summary.perLead.map((l) => {
            const totalFilled =
              (l.smart?.filled ?? 0) +
              (l.places?.filled ?? 0) +
              (l.instagram?.filled ?? 0) +
              (l.whois?.filled ?? 0);
            return (
              <li key={l.leadId} className="rounded-md border border-border bg-black/30 px-3 py-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <a
                    href={`/admin/av/${l.auditId}`}
                    className="text-base text-ink hover:text-brand transition-colors break-words"
                  >
                    {l.company || 'Untitled lead'}
                  </a>
                  <span className="text-sm text-muted">
                    {totalFilled === 0 ? 'nothing landed' : `${totalFilled} field${totalFilled === 1 ? '' : 's'} filled`}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {SOURCE_META.map((s) => {
                    const r = l[s.key];
                    if (!r) return null;
                    const filled = r.filled;
                    return (
                      <span
                        key={s.key}
                        className="text-xs px-2 py-0.5 rounded-full border"
                        style={{
                          borderColor: `${s.color}66`,
                          background: `${s.color}11`,
                          color: filled > 0 ? s.color : 'rgba(255,255,255,0.55)'
                        }}
                        title={r.reason ?? `${s.label} filled ${filled} field${filled === 1 ? '' : 's'}`}
                      >
                        {s.label}: {filled > 0 ? `+${filled}` : (r.reason ? r.reason.slice(0, 32) : '0')}
                      </span>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="text-sm px-4 py-1.5 rounded-md border border-border text-ink hover:bg-white/5"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
