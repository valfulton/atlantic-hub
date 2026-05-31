/**
 * VendorStatus — a small operator-only strip that names which third-party
 * vendor powers each capability, so when something breaks val knows exactly
 * where to look (and which credits to check). Server component: reads the
 * live Hunter credit usage for the month.
 *
 *   Enrichment  -> Hunter.io  (shows credits used / ceiling for the month)
 *   Discovery   -> Clay, Apollo, Google Places, Instagram (lead-finding sources)
 *
 * NOTE on the common mixup: ENRICHMENT (filling a lead's real contact) runs on
 * Hunter.io — NOT Clay. Clay is a DISCOVERY source (finding new companies). The
 * clay_enrichment_log table is misleadingly named. See the vendor-map memory.
 */
import { getHunterCreditStatus } from '@/lib/enrichment/enricher';

export async function VendorStatus() {
  const hunter = await getHunterCreditStatus().catch(() => null);
  const used = hunter?.used ?? 0;
  const ceiling = hunter?.ceiling ?? 0;
  const remaining = hunter?.remaining ?? 0;
  const source = hunter?.source ?? 'estimate';
  // (#287) Only treat 'out of credits' / 'running low' as the truth when the
  // numbers came from Hunter's live API. When source='estimate' it's our
  // local log, which over-counts (every call logged as 1 credit even when
  // Hunter didn't bill). val saw "220/75 — top up" while Hunter itself said
  // 22 used of 50 — exactly the over-count problem. Don't lie when unsure.
  const isLive = source === 'live';
  const low = isLive && ceiling > 0 && remaining <= Math.max(5, Math.round(ceiling * 0.15));
  const out = isLive && ceiling > 0 && remaining <= 0;
  const creditColor = out ? '#FF9AA8' : low ? '#fcd34d' : 'var(--muted)';

  return (
    <div className="rounded-xl border border-border bg-surface/60 px-4 py-3 mt-3 mb-4">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted mb-2">Vendors</div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted">Enrichment</span>
          <span className="text-ink font-medium">Hunter.io</span>
          {isLive ? (
            <span style={{ color: creditColor }}>
              {used}/{ceiling} credits this month{' '}
              {out ? '(none left — top up Hunter)' : low ? `(${remaining} left — running low)` : `(${remaining} left)`}
            </span>
          ) : (
            <span className="text-muted">
              live credit status unavailable —{' '}
              <a
                href="https://hunter.io/api_keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                check hunter.io
              </a>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted">Discovery</span>
          <span className="text-ink font-medium">Clay</span>
          <span className="text-muted">· Apollo · Google Places · Instagram</span>
          <a href="/admin/av/integrations/clay" className="text-brand hover:underline">Clay setup &rarr;</a>
        </div>
      </div>
      {out && (
        <p className="text-[11px] mt-2" style={{ color: '#FF9AA8' }}>
          Enrichment is out of Hunter credits this month — that&apos;s why &ldquo;Enrich&rdquo; would return nothing. Top up Hunter or wait for the monthly reset.
        </p>
      )}
    </div>
  );
}
