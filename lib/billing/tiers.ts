/**
 * lib/billing/tiers.ts  (#378, val 2026-06-03)
 *
 * The pricing matrix: 3 tiers × 9 vertical packs. Encoded as data so:
 *   1. Stripe products map cleanly (one Stripe Product per (tier, pack) pair).
 *   2. The public /pricing page renders from this without duplicating numbers.
 *   3. Sales can quote a price live without checking a spreadsheet.
 *   4. Enforcement (watchlist size cap, seat cap, adapter access) reads from
 *      one source of truth.
 *
 * The 3 tiers — same shape across every pack, different limits + price:
 *
 *   STARTER  — first taste; one seat; capped watchlist; core adapters only
 *   GROWTH   — working sales team; multi-seat; expanded watchlist; all live adapters
 *   PRO      — full org; unlimited seats; unlimited watchlist; planned adapters
 *              included as they ship; per-vertical white-label option
 *
 * Why per-vertical pricing varies: a commercial lender's intelligence is
 * more valuable per seat than a marketing agency's because the per-deal LTV
 * differs by 10-50×. Pack pricing reflects this. The Starter band normalizes
 * to entry-level "try it" pricing; Growth and Pro stretch.
 *
 * The numbers below MATCH the suggestedPriceUsd bands in vertical_packs.ts.
 * Stripe product IDs go in the env (STRIPE_PRICE_<TIER>_<PACK_ID>) so we
 * don't ship product secrets in code.
 */
import type { VerticalPackId } from '@/lib/public_intel/vertical_packs';

export type TierId = 'starter' | 'growth' | 'pro';

export interface TierLimits {
  /** Active distress-watchlist entries kept at any one time. Older entries roll off. */
  watchlistCap: number;
  /** Number of operator + rep seats included. -1 means unlimited. */
  seats: number;
  /** Cascade recipes the tier may enable. */
  cascadeRecipeAccess: 'live_only' | 'live_plus_pending' | 'all_including_white_label';
  /** Cron refresh cadence. */
  refreshCadence: 'weekly' | 'daily' | 'hourly';
  /** Per-month LLM cost ceiling (microcents) — soft cap, alerts val if exceeded. */
  monthlyLlmCeilingMicrocents: number;
  /** Per-month Hunter enrich credit cap. */
  monthlyHunterCredits: number;
  /** White-label / pack-resale rights. */
  whiteLabel: boolean;
}

export interface TierPriceForPack {
  packId: VerticalPackId;
  monthlyUsd: number;
  /** Stripe price id (looked up by env var name at runtime). */
  stripeEnvVar: string;
  limits: TierLimits;
  /** Marketing-page bullets unique to this tier × pack pairing. */
  highlights: string[];
}

const STARTER_LIMITS: TierLimits = {
  watchlistCap: 25,
  seats: 1,
  cascadeRecipeAccess: 'live_only',
  refreshCadence: 'weekly',
  monthlyLlmCeilingMicrocents: 500_000_000, // ~$5.00 in LLM spend
  monthlyHunterCredits: 50,
  whiteLabel: false
};
const GROWTH_LIMITS: TierLimits = {
  watchlistCap: 100,
  seats: 5,
  cascadeRecipeAccess: 'live_plus_pending',
  refreshCadence: 'daily',
  monthlyLlmCeilingMicrocents: 2_500_000_000, // ~$25
  monthlyHunterCredits: 250,
  whiteLabel: false
};
const PRO_LIMITS: TierLimits = {
  watchlistCap: -1, // unlimited
  seats: -1,
  cascadeRecipeAccess: 'all_including_white_label',
  refreshCadence: 'hourly',
  monthlyLlmCeilingMicrocents: 10_000_000_000, // ~$100
  monthlyHunterCredits: 1000,
  whiteLabel: true
};

/**
 * The matrix. Numbers anchor to the suggestedPriceUsd low/high bands in
 * vertical_packs.ts. Starter ≈ low band; Pro ≈ high band; Growth is the
 * midpoint, rounded.
 */
export const TIER_MATRIX: Record<TierId, TierPriceForPack[]> = {
  starter: [
    { packId: 'collections',          monthlyUsd: 499,  stripeEnvVar: 'STRIPE_PRICE_STARTER_COLLECTIONS',          limits: STARTER_LIMITS, highlights: ['CA SOS + CourtListener live', '2 cascades live', '25 entities/week', '1 seat'] },
    { packId: 'real_estate',          monthlyUsd: 499,  stripeEnvVar: 'STRIPE_PRICE_STARTER_REAL_ESTATE',          limits: STARTER_LIMITS, highlights: ['CA SOS + CourtListener live', 'RE recipes ready (adapters queued)', '25 entities/week', '1 seat'] },
    { packId: 'b2b_sales',            monthlyUsd: 299,  stripeEnvVar: 'STRIPE_PRICE_STARTER_B2B_SALES',            limits: STARTER_LIMITS, highlights: ['CA SOS live', 'new_llc cascade live', '25 prospects/week', '1 seat'] },
    { packId: 'commercial_insurance', monthlyUsd: 499,  stripeEnvVar: 'STRIPE_PRICE_STARTER_INSURANCE',            limits: STARTER_LIMITS, highlights: ['CA SOS live', 'new-business + leadership-change signals', '25 alerts/week', '1 seat'] },
    { packId: 'commercial_lending',   monthlyUsd: 999,  stripeEnvVar: 'STRIPE_PRICE_STARTER_LENDING',              limits: STARTER_LIMITS, highlights: ['CA SOS + CourtListener + HMDA + CFPB live', '3 cascades live', '25 borrowers OR defaults/week', '1 seat'] },
    { packId: 'law_firm',             monthlyUsd: 799,  stripeEnvVar: 'STRIPE_PRICE_STARTER_LAW',                  limits: STARTER_LIMITS, highlights: ['Practice-tuned signals', 'CourtListener + CA SOS', '4 cascades configured', '1 seat'] },
    { packId: 'recruiting',           monthlyUsd: 399,  stripeEnvVar: 'STRIPE_PRICE_STARTER_RECRUITING',           limits: STARTER_LIMITS, highlights: ['Hiring + growth signals', 'new_llc cascade live', '25 companies/week', '1 seat'] },
    { packId: 'marketing_agency',     monthlyUsd: 299,  stripeEnvVar: 'STRIPE_PRICE_STARTER_MARKETING',            limits: STARTER_LIMITS, highlights: ['CA SOS + review-trend (pending GBP)', '2 cascades', '25 brands/week', '1 seat'] },
    { packId: 'luxury_hospitality',   monthlyUsd: 999,  stripeEnvVar: 'STRIPE_PRICE_STARTER_LUXURY',               limits: STARTER_LIMITS, highlights: ['Specialized luxury intelligence', 'Nautical / event / hospitality signals', '25 opportunities/week', '1 seat'] }
  ],
  growth: [
    { packId: 'collections',          monthlyUsd: 999,  stripeEnvVar: 'STRIPE_PRICE_GROWTH_COLLECTIONS',           limits: GROWTH_LIMITS,  highlights: ['Everything in Starter', '+ UCC + PACER adapters when shipped', '100 entities/week', '5 seats', 'Daily refresh'] },
    { packId: 'real_estate',          monthlyUsd: 999,  stripeEnvVar: 'STRIPE_PRICE_GROWTH_REAL_ESTATE',           limits: GROWTH_LIMITS,  highlights: ['Everything in Starter', '+ CA recorder adapters as they ship', '100 properties/week', '5 seats', 'Daily refresh'] },
    { packId: 'b2b_sales',            monthlyUsd: 599,  stripeEnvVar: 'STRIPE_PRICE_GROWTH_B2B_SALES',             limits: GROWTH_LIMITS,  highlights: ['Everything in Starter', '+ hiring-surge adapter when shipped', '100 prospects/week', '5 seats', 'Daily refresh'] },
    { packId: 'commercial_insurance', monthlyUsd: 999,  stripeEnvVar: 'STRIPE_PRICE_GROWTH_INSURANCE',             limits: GROWTH_LIMITS,  highlights: ['Everything in Starter', '+ permits + vehicles when adapters ship', '100 alerts/week', '5 seats', 'Daily refresh'] },
    { packId: 'commercial_lending',   monthlyUsd: 2499, stripeEnvVar: 'STRIPE_PRICE_GROWTH_LENDING',               limits: GROWTH_LIMITS,  highlights: ['Everything in Starter', '+ D&B / Experian integration option', '100 entities/week', '5 seats', 'Daily refresh'] },
    { packId: 'law_firm',             monthlyUsd: 1799, stripeEnvVar: 'STRIPE_PRICE_GROWTH_LAW',                   limits: GROWTH_LIMITS,  highlights: ['Everything in Starter', '+ PACER docket scraping for bankruptcy', '100 case alerts/week', '5 seats', 'Daily refresh'] },
    { packId: 'recruiting',           monthlyUsd: 799,  stripeEnvVar: 'STRIPE_PRICE_GROWTH_RECRUITING',            limits: GROWTH_LIMITS,  highlights: ['Everything in Starter', '+ funding-event signals when shipped', '100 companies/week', '5 seats', 'Daily refresh'] },
    { packId: 'marketing_agency',     monthlyUsd: 799,  stripeEnvVar: 'STRIPE_PRICE_GROWTH_MARKETING',             limits: GROWTH_LIMITS,  highlights: ['Everything in Starter', '+ Google Business Profile when shipped', '100 brands/week', '5 seats', 'Daily refresh'] },
    { packId: 'luxury_hospitality',   monthlyUsd: 2499, stripeEnvVar: 'STRIPE_PRICE_GROWTH_LUXURY',                limits: GROWTH_LIMITS,  highlights: ['Everything in Starter', '+ yacht / marina / luxury-hotel specialized adapters as they ship', '100 opportunities/week', '5 seats', 'Daily refresh'] }
  ],
  pro: [
    { packId: 'collections',          monthlyUsd: 1499, stripeEnvVar: 'STRIPE_PRICE_PRO_COLLECTIONS',              limits: PRO_LIMITS,     highlights: ['Everything in Growth', 'Unlimited watchlist', 'Unlimited seats', 'Hourly refresh', 'White-label / pack resale option'] },
    { packId: 'real_estate',          monthlyUsd: 1999, stripeEnvVar: 'STRIPE_PRICE_PRO_REAL_ESTATE',              limits: PRO_LIMITS,     highlights: ['Everything in Growth', 'Unlimited properties + seats', 'Hourly refresh', 'White-label / pack resale'] },
    { packId: 'b2b_sales',            monthlyUsd: 999,  stripeEnvVar: 'STRIPE_PRICE_PRO_B2B_SALES',                limits: PRO_LIMITS,     highlights: ['Everything in Growth', 'Unlimited prospects + seats', 'Hourly refresh', 'White-label'] },
    { packId: 'commercial_insurance', monthlyUsd: 1499, stripeEnvVar: 'STRIPE_PRICE_PRO_INSURANCE',                limits: PRO_LIMITS,     highlights: ['Everything in Growth', 'Unlimited alerts + producers', 'Hourly refresh', 'White-label'] },
    { packId: 'commercial_lending',   monthlyUsd: 4999, stripeEnvVar: 'STRIPE_PRICE_PRO_LENDING',                  limits: PRO_LIMITS,     highlights: ['Everything in Growth', 'Unlimited entities + relationship managers', 'Hourly refresh', 'White-label / regional-bank-branded'] },
    { packId: 'law_firm',             monthlyUsd: 2999, stripeEnvVar: 'STRIPE_PRICE_PRO_LAW',                      limits: PRO_LIMITS,     highlights: ['Everything in Growth', 'Per-practice-group seats', 'Hourly refresh', 'White-label / firm-branded'] },
    { packId: 'recruiting',           monthlyUsd: 1299, stripeEnvVar: 'STRIPE_PRICE_PRO_RECRUITING',               limits: PRO_LIMITS,     highlights: ['Everything in Growth', 'Unlimited companies + recruiters', 'Hourly refresh', 'White-label'] },
    { packId: 'marketing_agency',     monthlyUsd: 1499, stripeEnvVar: 'STRIPE_PRICE_PRO_MARKETING',                limits: PRO_LIMITS,     highlights: ['Everything in Growth', 'Unlimited brands + producers', 'Hourly refresh', 'White-label'] },
    { packId: 'luxury_hospitality',   monthlyUsd: 4999, stripeEnvVar: 'STRIPE_PRICE_PRO_LUXURY',                   limits: PRO_LIMITS,     highlights: ['Everything in Growth', 'Unlimited opportunities + concierges', 'Hourly refresh', 'White-label / brand-licensed'] }
  ]
};

export function priceFor(tier: TierId, packId: VerticalPackId): TierPriceForPack | null {
  return TIER_MATRIX[tier]?.find((p) => p.packId === packId) ?? null;
}

export function tierLabel(tier: TierId): string {
  return tier === 'starter' ? 'Starter' : tier === 'growth' ? 'Growth' : 'Pro';
}

export function tierShortPositioning(tier: TierId): string {
  if (tier === 'starter') return 'First taste — solo operator getting started';
  if (tier === 'growth') return 'Working sales team — daily refresh + multi-seat';
  return 'Full org — unlimited everything + white-label option';
}
