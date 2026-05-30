'use client';

/**
 * EnrichFromPlacesButton  (#268)
 *
 * Per-lead Google Places enrich. One click runs a Places text search
 * against the lead's company name (+ city/state if known), picks the top
 * match, and fills blank fields via enrichLeadFromSource. Soft failures
 * (no match, ambiguous, missing API key) render inline below the button.
 *
 * On success: shows what filled, names the place matched, and refreshes the
 * server-rendered page so the Identity fields reflect the new values.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface MatchedPlace {
  placeId: string;
  name: string;
  address: string | null;
  websiteUri: string | null;
  primaryType: string | null;
  rating: number | null;
  userRatingCount: number | null;
}

interface EnrichResponse {
  ok: boolean;
  filled?: number;
  fields?: string[];
  matchedPlace?: MatchedPlace;
  reason?: string;
}

export function EnrichFromPlacesButton({ auditId, hasCompany }: { auditId: string; hasCompany: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EnrichResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/enrich-from-places`, { method: 'POST' });
      const j: EnrichResponse = await res.json().catch(() => ({ ok: false }));
      if (!res.ok) {
        setErr(j.reason ?? `HTTP ${res.status}`);
        return;
      }
      setResult(j);
      if (j.ok && (j.filled ?? 0) > 0) {
        // Identity fields are server-rendered — soft refresh to reflect.
        router.refresh();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={busy || !hasCompany}
        title={
          !hasCompany
            ? 'Set the Company field on the Identity tab first — Places search needs a name.'
            : "Search Google Places for this company + fill blank fields (address, phone, rating, etc). Never overwrites curated data."
        }
        className={
          'text-sm px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition ' +
          (busy || !hasCompany
            ? 'bg-white/10 text-white/40 cursor-not-allowed'
            : 'border border-border text-ink hover:border-amber-400/40 bg-black/20')
        }
      >
        {busy ? (
          <>
            <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Looking up Places…
          </>
        ) : (
          <>🗺️ Pull Places data</>
        )}
      </button>

      {result && result.ok && result.matchedPlace && (
        <div className="text-[11px] leading-snug" style={{ color: (result.filled ?? 0) > 0 ? '#86efac' : 'rgba(255,255,255,0.6)' }}>
          {(result.filled ?? 0) > 0 ? (
            <>
              Filled {result.filled} field{result.filled === 1 ? '' : 's'}
              {result.fields && result.fields.length > 0 && (
                <> · {result.fields.join(', ')}</>
              )}
            </>
          ) : (
            <>Match found, but nothing new to fill — your data was already complete.</>
          )}
          <div className="text-muted mt-0.5">
            Matched: <span className="text-ink/80">{result.matchedPlace.name}</span>
            {typeof result.matchedPlace.rating === 'number' && (
              <> · ★ {result.matchedPlace.rating.toFixed(1)}{result.matchedPlace.userRatingCount ? ` (${result.matchedPlace.userRatingCount})` : ''}</>
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
    </div>
  );
}
