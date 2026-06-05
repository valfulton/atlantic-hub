'use client';

/**
 * FindAnotherPocButton  (#252 Inc 3)
 *
 * Operator-side action on the lead detail row. One click runs the cheapest
 * single-credit Apollo re-call (organization_top_people) at the lead's
 * company, applies the ICP title filter + drops the current contact's title,
 * and inserts the first survivor as a new sibling lead at the same company.
 *
 * UX matches the SmartEnrichButton — disabled-with-tooltip when the lead
 * has no Apollo org id (the path only works for Apollo-sourced leads), quiet
 * inline result line on success, soft-failure reason inline when the filter
 * dropped everyone or the org has no other people. No modal — the lead
 * detail page already has enough chrome.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface FindAnotherPocResponse {
  ok: boolean;
  newAuditId?: string;
  newContactName?: string;
  newContactTitle?: string | null;
  candidatesReturned?: number;
  candidatesAfterFilter?: number;
  reason?: string;
}

export function FindAnotherPocButton({
  auditId,
  hasApolloOrg
}: {
  auditId: string;
  /** False when the lead's source_payload has no apollo_organization_id — the
   *  path only works for Apollo-sourced leads. Stays disabled with a tooltip
   *  explaining why so val never wastes a click. */
  hasApolloOrg: boolean;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FindAnotherPocResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/find-another-poc`, {
        method: 'POST'
      });
      const data: FindAnotherPocResponse = await res.json().catch(() => ({ ok: false }));
      if (!res.ok) {
        // Genuine HTTP error (auth, AV disabled). Surface generically.
        throw new Error(data.reason ?? `HTTP ${res.status}`);
      }
      setResult(data);
      if (data.ok) {
        // The new lead is in the operator pipeline — refresh so it shows in
        // adjacent lists if val came from a roster. The user can also click
        // the deep-link in the success line below.
        router.refresh();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={running || !hasApolloOrg}
        title={
          !hasApolloOrg
            ? 'This lead did not come from Apollo — Find another POC only works for Apollo-sourced leads.'
            : "Re-call Apollo at this company, skip the current contact's title + any ICP-excluded titles, insert the first survivor as a new lead. ~1 Apollo credit."
        }
        className={
          'text-sm px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition ' +
          (running || !hasApolloOrg
            ? 'bg-white/10 text-white/40 cursor-not-allowed'
            : 'border border-border text-ink hover:border-[color-mix(in_srgb,var(--gold-bright)_35%,transparent)] bg-black/20')
        }
      >
        {running ? (
          <>
            <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Finding another POC…
          </>
        ) : (
          <>🔍 Find another POC</>
        )}
      </button>

      {result && result.ok && result.newAuditId && (
        <div className="text-[11px] leading-snug" style={{ color: '#86efac' }}>
          Added{' '}
          <a
            href={`/admin/av/${result.newAuditId}`}
            className="underline-offset-2 hover:underline font-medium"
            style={{ color: '#86efac' }}
          >
            {result.newContactName ?? 'new contact'}
            {result.newContactTitle ? ` (${result.newContactTitle})` : ''}
          </a>
          {typeof result.candidatesReturned === 'number' && typeof result.candidatesAfterFilter === 'number' && (
            <span className="text-muted">
              {' '}· {result.candidatesAfterFilter} of {result.candidatesReturned} passed the title filter
            </span>
          )}
        </div>
      )}

      {result && !result.ok && result.reason && (
        <div className="text-[11px] leading-snug" style={{ color: '#fde68a' }}>
          {result.reason}
        </div>
      )}

      {err && (
        <div className="text-[11px] leading-snug" style={{ color: '#fca5a5' }}>
          {err}
        </div>
      )}
    </div>
  );
}
