/**
 * /pricing  (#378→#379 reframed, val 2026-06-03)
 *
 * NOTE: This is NOT the public-facing pricing for AV's main offering.
 * AV's main packages (Sprint $1,995 / Momentum $3,995 / Scale $7,995) are
 * on the marketing site at atlanticandvine.com — those are done-for-you
 * agency packages where AV runs the platform for the client.
 *
 * This page is a FUTURE platform-license reference — for when AV is ready
 * to license the Hub to OTHER agencies / in-house teams who want to
 * self-serve. Not advertised yet; lives at /pricing in the app for val's
 * internal review only. When val is ready to open self-serve, this becomes
 * the public surface.
 *
 * Renders from lib/billing/tiers.ts so the matrix has one source of truth.
 */
import { TIER_MATRIX, tierLabel, tierShortPositioning, type TierId } from '@/lib/billing/tiers';
import { VERTICAL_PACKS, type VerticalPackId } from '@/lib/public_intel/vertical_packs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIER_ORDER: TierId[] = ['starter', 'growth', 'pro'];

function formatPrice(usd: number): string {
  return `$${usd.toLocaleString()}`;
}

export default function PricingPage() {
  const packIds = Object.keys(VERTICAL_PACKS) as VerticalPackId[];
  return (
    <main className="min-h-screen bg-bg text-ink">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <header className="mb-8">
          <div className="text-[11px] uppercase tracking-[0.18em] text-brand mb-2">Platform license · internal preview</div>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-3">
            Atlantic Hub — self-serve platform license
          </h1>
          <p className="text-lg text-ink/80 max-w-3xl leading-snug">
            Looking for the done-for-you Atlantic & Vine agency packages (Sprint / Momentum / Scale)? Those live at{' '}
            <a href="https://atlanticandvine.com" className="text-brand hover:underline">atlanticandvine.com</a>.
            This page is the future self-serve platform license — when AV opens up direct access for in-house teams
            and partner agencies who want to run the engine themselves.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-md border border-[#EBCB6B]/35 bg-[#EBCB6B]/10 px-3 py-1.5 text-[12px] text-[#EBCB6B]/95">
            <span className="text-[#EBCB6B]">●</span> Not yet available for purchase — internal reference for pricing decisions.
          </div>
        </header>

        <section className="rounded-2xl border border-border bg-surface p-6 mb-8">
          <div className="text-[11px] uppercase tracking-[0.14em] text-brand mb-2">How this relates to AV's main packages</div>
          <p className="text-[13px] text-ink/85 leading-snug">
            AV's <strong className="text-ink">Sprint / Momentum / Scale</strong> packages are done-for-you services where AV's team runs the
            platform on the client's behalf — full-service marketing + intelligence + outreach. Those packages
            include everything the platform does, configured for the client's vertical, with AV's experts driving
            it. <br /><br />
            This license tier is the same platform, self-served. For partner agencies who want to resell it under
            their own brand, or in-house teams that want the intelligence engine without the agency service.
            The pack you pick configures the engine for your industry; the tier you pick scales it to your team.
          </p>
        </section>

        {/* Tier overview row */}
        <section className="grid md:grid-cols-3 gap-4 mb-10">
          {TIER_ORDER.map((tier) => (
            <div key={tier} className="rounded-2xl border border-border bg-surface p-5">
              <div className="text-[11px] uppercase tracking-[0.14em] text-brand mb-1">{tierLabel(tier)}</div>
              <div className="text-sm text-ink/85 leading-snug">{tierShortPositioning(tier)}</div>
              <ul className="mt-3 grid gap-1 text-[12.5px] text-ink/85">
                {tier === 'starter' && (
                  <>
                    <li>· 1 seat</li>
                    <li>· 25 watchlist entries / week</li>
                    <li>· Weekly refresh</li>
                    <li>· Live cascade recipes</li>
                  </>
                )}
                {tier === 'growth' && (
                  <>
                    <li>· 5 seats</li>
                    <li>· 100 watchlist entries / week</li>
                    <li>· Daily refresh</li>
                    <li>· Live + pending recipes</li>
                  </>
                )}
                {tier === 'pro' && (
                  <>
                    <li>· Unlimited seats</li>
                    <li>· Unlimited watchlist</li>
                    <li>· Hourly refresh</li>
                    <li>· White-label / pack-resale</li>
                  </>
                )}
              </ul>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-border bg-surface overflow-hidden mb-8">
          <div className="px-5 py-4 border-b border-border bg-brand/[0.04]">
            <div className="text-[11px] uppercase tracking-[0.14em] text-brand mb-1">By vertical pack (internal reference)</div>
            <p className="text-sm text-ink/85 leading-snug">
              Pricing varies by pack because the underlying adapter costs and per-deal LTV differ. Commercial Lending
              and Luxury Hospitality include premium adapters (HMDA + PACER docket / yacht registries). Marketing
              and B2B Sales price at the entry band.
            </p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted border-b border-border">
                <th className="px-4 py-3 font-medium">Pack</th>
                {TIER_ORDER.map((tier) => (
                  <th key={tier} className="px-4 py-3 font-medium text-right">{tierLabel(tier)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {packIds.map((packId) => {
                const pack = VERTICAL_PACKS[packId];
                return (
                  <tr key={packId} className="border-b border-border last:border-0 hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 align-top">
                      <div className="text-ink font-medium">{pack.displayName}</div>
                      <div className="text-[11.5px] text-ink/65 italic leading-snug mt-0.5">
                        &ldquo;{pack.shortPositioning}&rdquo;
                      </div>
                    </td>
                    {TIER_ORDER.map((tier) => {
                      const row = TIER_MATRIX[tier].find((r) => r.packId === packId);
                      if (!row) return <td key={tier} className="px-4 py-3 text-right text-muted">—</td>;
                      return (
                        <td key={tier} className="px-4 py-3 text-right align-top">
                          <div className="text-lg text-ink font-medium tabular-nums">{formatPrice(row.monthlyUsd)}<span className="text-[11px] text-muted font-normal">/mo</span></div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <p className="text-[11.5px] text-muted text-center">
          Internal reference · For AV's done-for-you Sprint / Momentum / Scale packages see{' '}
          <a href="https://atlanticandvine.com" className="text-brand hover:underline">atlanticandvine.com</a>.
        </p>
      </div>
    </main>
  );
}
