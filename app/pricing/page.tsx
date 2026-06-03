/**
 * /pricing  (#378, val 2026-06-03)
 *
 * Public pricing page. Renders the 3 tiers × 9 packs matrix from
 * lib/billing/tiers.ts so the numbers are never duplicated between
 * Stripe + marketing copy + sales reference.
 *
 * Aesthetic per memory `feedback_brand_aesthetic`: dark-navy + amber + nautical
 * luxury. Per memory `feedback_contrast_rule`: never white-on-amber; bg-brand
 * always text-black.
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
        <header className="mb-10">
          <div className="text-[11px] uppercase tracking-[0.18em] text-brand mb-2">Pricing</div>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-3">
            One platform. Nine industries. Your tier.
          </h1>
          <p className="text-lg text-ink/80 max-w-3xl leading-snug">
            Atlantic Hub is a <strong className="text-ink">Revenue Intelligence Operating System</strong> — the
            same engine watches business formation, growth, legal activity, reputation, financing, and
            operational signals across every vertical. Pick the pack for your industry, the tier for your team,
            and start seeing the businesses about to need what you sell.
          </p>
        </header>

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
                    <li>· Live + pending recipes (activate as adapters ship)</li>
                  </>
                )}
                {tier === 'pro' && (
                  <>
                    <li>· Unlimited seats</li>
                    <li>· Unlimited watchlist</li>
                    <li>· Hourly refresh</li>
                    <li>· White-label / pack-resale option</li>
                  </>
                )}
              </ul>
            </div>
          ))}
        </section>

        {/* Pack pricing rows */}
        <section className="rounded-2xl border border-border bg-surface overflow-hidden mb-8">
          <div className="px-5 py-4 border-b border-border bg-brand/[0.04]">
            <div className="text-[11px] uppercase tracking-[0.14em] text-brand mb-1">Pick your pack</div>
            <p className="text-sm text-ink/85 leading-snug">
              Each pack tunes the engine for one industry — different signal weights, different cascade recipes,
              different pitch language. The platform is one product; the packs are nine. The marketing automation
              (commercials, outreach, PR, social, calendar) is included with every pack.
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
                      <div className="text-[11px] text-muted mt-1">
                        Best for: {pack.bestForRoles.slice(0, 2).join(' · ')}
                      </div>
                    </td>
                    {TIER_ORDER.map((tier) => {
                      const row = TIER_MATRIX[tier].find((r) => r.packId === packId);
                      if (!row) return <td key={tier} className="px-4 py-3 text-right text-muted">—</td>;
                      return (
                        <td key={tier} className="px-4 py-3 text-right align-top">
                          <div className="text-lg text-ink font-medium tabular-nums">{formatPrice(row.monthlyUsd)}<span className="text-[11px] text-muted font-normal">/mo</span></div>
                          <ul className="mt-1 text-[10.5px] text-ink/65 leading-snug">
                            {row.highlights.slice(0, 3).map((h, i) => (
                              <li key={i}>· {h}</li>
                            ))}
                          </ul>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* The "what's in it" block */}
        <section className="rounded-2xl border border-border bg-surface p-6 mb-8">
          <div className="text-[11px] uppercase tracking-[0.14em] text-brand mb-2">What every plan includes</div>
          <div className="grid md:grid-cols-3 gap-5">
            <div>
              <div className="text-sm text-ink font-medium mb-1">Predictive intelligence engine</div>
              <p className="text-[12.5px] text-ink/75 leading-snug">
                Federal court filings, state filings, UCC, Census ACS, CFPB, reputation signals — cascade-chained
                into per-entity scores. You see who&apos;s about to need what you sell, with the signal-attribution
                receipts to prove it.
              </p>
            </div>
            <div>
              <div className="text-sm text-ink font-medium mb-1">Marketing activation suite</div>
              <p className="text-[12.5px] text-ink/75 leading-snug">
                AI-drafted commercials, outreach emails, PR pitches, social content, brand-aware calendar. Every
                artifact reads like you wrote it because it&apos;s grounded in your client brief + the cascade
                signal that surfaced the prospect.
              </p>
            </div>
            <div>
              <div className="text-sm text-ink font-medium mb-1">Institutional memory spine</div>
              <p className="text-[12.5px] text-ink/75 leading-snug">
                Every interaction deposits structured intelligence into a per-client memory. By month six the
                platform knows more about your buyers than you do. By month twelve, more than your competitors
                ever will.
              </p>
            </div>
          </div>
        </section>

        <p className="text-[11.5px] text-muted text-center">
          Inquire about volume + custom packs at <a href="mailto:hello@atlanticandvine.com" className="text-brand hover:underline">hello@atlanticandvine.com</a>. White-label and pack-resale available on Pro.
        </p>
      </div>
    </main>
  );
}
