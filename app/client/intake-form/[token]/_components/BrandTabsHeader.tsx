/**
 * BrandTabsHeader  (#45 Phase B, val 2026-06-02)
 *
 * Shown above the intake form when the share token is owner-scoped
 * (Adriana = CBB + CLDA under one login). One tab per brand the owner
 * belongs to; clicking a tab navigates to the same intake page with
 * ?brand=<id>. Server re-renders, loads that brand's brief + social
 * targets, and ClientIntakeForm gets the new initial.
 *
 * Server component on purpose -- the tab switch is a real navigation
 * (the form unmounts + remounts with new data, which is the safer UX
 * since draft autosave is per-form).
 */
import Link from 'next/link';

export interface BrandTab {
  clientId: number;
  clientName: string | null;
}

export default function BrandTabsHeader({
  brands,
  activeClientId,
  token
}: {
  brands: BrandTab[];
  activeClientId: number;
  token: string;
}) {
  if (brands.length < 2) return null; // only render when there are real tabs
  return (
    <div className="mb-6 -mt-2">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted mb-2">Your brands</div>
      <div className="flex flex-wrap gap-1 border-b border-border">
        {brands.map((b) => {
          const active = b.clientId === activeClientId;
          return (
            <Link
              key={b.clientId}
              href={`/client/intake-form/${token}?brand=${b.clientId}`}
              prefetch={false}
              className={
                'px-4 py-2 text-sm rounded-t-md border ' +
                (active
                  ? 'border-border border-b-transparent bg-surface text-ink font-medium'
                  : 'border-transparent text-muted hover:text-ink hover:bg-surface/40')
              }
            >
              {b.clientName || `Brand #${b.clientId}`}
            </Link>
          );
        })}
      </div>
      <div className="text-[11px] text-muted mt-2">
        Each brand has its own intake. Switch tabs to fill in the next one.
      </div>
    </div>
  );
}
