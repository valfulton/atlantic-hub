'use client';

/**
 * SmartEnrichButton  (#251 Inc 1c-prime UI)
 *
 * Operator-side button on the lead detail page: "✨ Smart enrich from website".
 * Calls /api/admin/av/discover/scrape with mode='smart_fill', which runs the
 * LLM-driven intake scraper against the lead's website and fills any blank
 * lead columns + stashes the full intake-shape suggestion in source_payload
 * for later carryover to a client (#253).
 *
 * Defaults to blanks-only fill — never clobbers a hand-curated value. The
 * intake AI-fill panel (on the client page) is where overwrites happen
 * because the operator is reviewing each suggestion; here we just want a
 * one-click "compound this lead's intelligence" action.
 *
 * Disabled when the lead has no website (nothing to scrape). Surfaces a short
 * result line below the button instead of a modal — the lead detail page
 * already has plenty of UI; a quiet inline summary fits better.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface SmartFillResponse {
  ok: boolean;
  reason?: string;
  fetchedUrl?: string | null;
  pageSummary?: string | null;
  proposedFieldCount?: number;
  filledFieldCount?: number;
  filledFields?: string[];
  metadataMerged?: boolean;
}

export function SmartEnrichButton({
  auditId,
  hasWebsite
}: {
  auditId: string;
  /** When false the button stays disabled with a helpful tooltip — no point
   *  burning the LLM call if the lead has no URL to scrape. */
  hasWebsite: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SmartFillResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSmartFill() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/admin/av/discover/scrape', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'smart_fill', auditId })
      });
      const data: SmartFillResponse = await res.json().catch(() => ({ ok: false }));
      if (!res.ok || !data.ok) {
        // 422 = the lead has no usable URL / SPA / page-read failed. Surface
        // the reason cleanly so val knows whether to retry, try a different
        // URL, or give up on this lead.
        const reason = data.reason ?? `HTTP ${res.status}`;
        throw new Error(reason);
      }
      setResult(data);
      // Refresh the server component so the new column values appear on the
      // detail page. Without this, val would see the success line but have
      // to manually reload to see the new phone/industry/etc.
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1.5">
      <button
        type="button"
        onClick={runSmartFill}
        disabled={running || !hasWebsite}
        title={
          !hasWebsite
            ? 'No website on this lead — nothing to scrape. Add a website URL first.'
            : 'Read the lead\'s website with the LLM and fill blank fields (~$0.01).'
        }
        className={
          'text-sm px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition ' +
          (running || !hasWebsite
            ? 'bg-white/10 text-white/40 cursor-not-allowed'
            : 'bg-brand text-white hover:opacity-90')
        }
      >
        {running ? (
          <>
            <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Reading website…
          </>
        ) : (
          <>✨ Smart enrich from website</>
        )}
      </button>

      {/* Quiet inline result — no modal. The page itself refreshes to show the
          new column values; this line is just confirmation + lineage. */}
      {result && result.ok && (
        <div className="text-[11px] leading-snug" style={{ color: '#86efac' }}>
          Filled {result.filledFieldCount ?? 0} of {result.proposedFieldCount ?? 0} fields
          {result.filledFields && result.filledFields.length > 0
            ? ` (${result.filledFields.join(', ')})`
            : ''}
          {result.metadataMerged ? ' · stashed full intake draft' : ''}
        </div>
      )}
      {result && result.ok && (result.filledFieldCount ?? 0) === 0 && (
        <div className="text-[11px] leading-snug text-muted">
          Page read OK but every field we could fill was already filled.
        </div>
      )}
      {error && (
        <div className="text-[11px] leading-snug" style={{ color: '#fca5a5' }}>
          Couldn&apos;t enrich: {error}
        </div>
      )}
    </div>
  );
}
