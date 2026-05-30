'use client';

/**
 * EnrichFromInstagramButton  (#269)
 *
 * Per-lead Instagram enrich. One click runs handle-resolution (scraped
 * socials → previous IG enrich → company-name guess), fetches the profile,
 * fills blanks via enrichLeadFromSource. If auto-resolution fails, val
 * can paste a handle directly in the small override field that appears.
 *
 * Soft failures (no handle, profile not found, missing Apify token) render
 * inline below the button.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface MatchedProfile {
  username: string;
  fullName: string | null;
  profileUrl: string | null;
  biography: string | null;
  businessCategory: string | null;
  followersCount: number | null;
  isVerified: boolean | null;
}

interface EnrichResponse {
  ok: boolean;
  filled?: number;
  fields?: string[];
  matchedHandle?: string;
  matchedProfile?: MatchedProfile;
  handleSource?: 'override' | 'scraped' | 'previous_enrich' | 'company_name_fallback';
  reason?: string;
}

const HANDLE_SOURCE_LABEL: Record<NonNullable<EnrichResponse['handleSource']>, string> = {
  override: 'manual entry',
  scraped: 'from website',
  previous_enrich: 'from prior IG enrich',
  company_name_fallback: 'guessed from company name'
};

export function EnrichFromInstagramButton({ auditId }: { auditId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EnrichResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Override input — opens when the auto-resolve fails so val can paste @ndvip
  // directly. Keeps the action discoverable without cluttering the row.
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideHandle, setOverrideHandle] = useState('');

  async function run(opts?: { handleOverride?: string }) {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const body = opts?.handleOverride ? JSON.stringify({ handle: opts.handleOverride }) : undefined;
      const res = await fetch(`/api/admin/av/leads/${auditId}/enrich-from-instagram`, {
        method: 'POST',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body } : {})
      });
      const j: EnrichResponse = await res.json().catch(() => ({ ok: false }));
      if (!res.ok) {
        setErr(j.reason ?? `HTTP ${res.status}`);
        return;
      }
      setResult(j);
      // If auto-resolve failed, surface the override input so val can retry
      // with a known handle without leaving the page.
      if (!j.ok) setOverrideOpen(true);
      if (j.ok && (j.filled ?? 0) > 0) router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1.5 max-w-xs">
      <button
        type="button"
        onClick={() => run()}
        disabled={busy}
        title="Find this lead's Instagram and fill blank fields (industry, phone, website). Never overwrites curated data."
        className={
          'text-sm px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition ' +
          (busy
            ? 'bg-white/10 text-white/40 cursor-not-allowed'
            : 'border border-border text-ink hover:border-amber-400/40 bg-black/20')
        }
      >
        {busy ? (
          <>
            <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Pulling IG…
          </>
        ) : (
          <>📷 Pull Instagram data</>
        )}
      </button>

      {result && result.ok && result.matchedProfile && (
        <div className="text-[11px] leading-snug" style={{ color: (result.filled ?? 0) > 0 ? '#86efac' : 'rgba(255,255,255,0.6)' }}>
          {(result.filled ?? 0) > 0 ? (
            <>
              Filled {result.filled} field{result.filled === 1 ? '' : 's'}
              {result.fields && result.fields.length > 0 && <> · {result.fields.join(', ')}</>}
            </>
          ) : (
            <>Found the profile, but nothing new to fill — your data was already complete.</>
          )}
          <div className="text-muted mt-0.5">
            Matched:{' '}
            <a
              href={result.matchedProfile.profileUrl ?? `https://instagram.com/${result.matchedProfile.username}`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-ink/80 underline-offset-2 hover:underline"
            >
              @{result.matchedProfile.username}
            </a>
            {result.matchedProfile.fullName && <> · {result.matchedProfile.fullName}</>}
            {typeof result.matchedProfile.followersCount === 'number' && (
              <> · {result.matchedProfile.followersCount.toLocaleString()} followers</>
            )}
            {result.handleSource && (
              <span className="text-muted/70"> · handle {HANDLE_SOURCE_LABEL[result.handleSource]}</span>
            )}
          </div>
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

      {(overrideOpen || result?.ok === false) && (
        <div className="flex items-center gap-1.5 mt-1">
          <input
            type="text"
            value={overrideHandle}
            onChange={(e) => setOverrideHandle(e.target.value)}
            placeholder="@handle or paste profile URL"
            disabled={busy}
            className="flex-1 text-[11px] bg-black/30 border border-border rounded px-2 py-1 text-ink focus:outline-none focus:border-amber-400/50"
          />
          <button
            type="button"
            onClick={() => run({ handleOverride: overrideHandle })}
            disabled={busy || !overrideHandle.trim()}
            className={
              'text-[11px] px-2 py-1 rounded border transition ' +
              (busy || !overrideHandle.trim()
                ? 'border-white/10 text-white/30 cursor-not-allowed'
                : 'border-amber-400/40 text-amber-200 hover:border-amber-400/70 bg-amber-400/10')
            }
          >
            Try this
          </button>
        </div>
      )}
    </div>
  );
}
