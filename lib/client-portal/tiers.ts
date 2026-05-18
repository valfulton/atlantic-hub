/**
 * Tier feature matrix for the client portal.
 *
 * Source of truth for what's "included" at each tier vs. "locked behind
 * an upgrade". Used by both /api/client/me (JSON for ad-hoc clients) and
 * the server-rendered /client/dashboard page.
 *
 * Tier names match AV_livewebsite/js/packages.js (Client Surge --
 * Sprint / Momentum / Scale). These IDs are tied to live Stripe products
 * and must not be renamed without coordinated billing changes.
 *
 * Edit here, both surfaces update. Pricing copy is duplicated from
 * atlanticandvine.netlify.app/#pricing -- keep in sync when prices change.
 */
export type ClientTier = 'audit_only' | 'sprint' | 'momentum' | 'scale';

export interface TierLockedFeature {
  name: string;
  tier: 'Sprint' | 'Momentum' | 'Scale';
}

export interface TierFeatures {
  included: string[];
  locked: TierLockedFeature[];
}

export const TIER_LABEL: Record<ClientTier, string> = {
  audit_only: 'Free Audit',
  sprint: 'Sprint',
  momentum: 'Momentum',
  scale: 'Scale'
};

export const TIER_PRICE_HINT: Record<ClientTier, string> = {
  audit_only: 'Free',
  sprint: '$1,995/mo',
  momentum: '$3,995/mo',
  scale: '$7,995/mo'
};

export const TIER_FEATURES: Record<ClientTier, TierFeatures> = {
  audit_only: {
    included: [
      'AI-generated Strategic Marketing Audit',
      'Portal access with your audit always available',
      '1 free AI commercial after your audit (image or 6-second video)'
    ],
    locked: [
      { name: 'Multi-source lead discovery (Apollo + Places + Instagram)', tier: 'Sprint' },
      { name: 'AI lead scoring with Hot/Warm/Cool bands', tier: 'Sprint' },
      { name: 'Automated email enrichment via Hunter.io', tier: 'Sprint' },
      { name: 'CSV import + bulk pipeline management', tier: 'Sprint' },
      { name: '4 AI Commercial Videos + 8 Hero Images per month', tier: 'Sprint' },
      { name: '12 AI Commercial Videos + 24 Hero Images per month (premium model)', tier: 'Momentum' },
      { name: 'AI social-content generation (LinkedIn + X + Instagram)', tier: 'Momentum' },
      { name: 'Email outreach automation with reply tracking', tier: 'Momentum' },
      { name: '30 AI Commercial Videos + 60 Hero Images per month + human creative review', tier: 'Scale' },
      { name: 'White-label deployment for your agency', tier: 'Scale' }
    ]
  },
  sprint: {
    included: [
      'AI-generated Strategic Marketing Audit',
      'Multi-source lead discovery (Apollo + Places + Instagram)',
      'AI lead scoring with Hot/Warm/Cool bands',
      'Automated email enrichment via Hunter.io',
      'CSV import + bulk pipeline management',
      '4 AI Commercial Videos per month (6-sec, ready-to-post)',
      '8 AI Hero Images per month (1K, all aspect ratios)',
      'Portal access with your audit + leads always available'
    ],
    locked: [
      { name: '12 AI Commercial Videos + 24 Hero Images per month (premium model)', tier: 'Momentum' },
      { name: 'AI social-content generation (LinkedIn + X + Instagram)', tier: 'Momentum' },
      { name: 'Email outreach automation with reply tracking', tier: 'Momentum' },
      { name: '30 AI Commercial Videos + 60 Hero Images per month + human creative review', tier: 'Scale' },
      { name: 'White-label deployment for your agency', tier: 'Scale' }
    ]
  },
  momentum: {
    included: [
      'Everything in Sprint',
      '12 AI Commercial Videos per month (6-sec, premium model)',
      '24 AI Hero Images per month (2K, all aspect ratios)',
      'AI social-content generation (LinkedIn + X + Instagram)',
      'Email outreach automation with reply tracking',
      'Advanced pipeline analytics',
      '1-click auto-post to LinkedIn / Instagram / X (as connectors ship)'
    ],
    locked: [
      { name: '30 AI Commercial Videos + 60 Hero Images per month + human creative review', tier: 'Scale' },
      { name: 'White-label deployment for your agency', tier: 'Scale' }
    ]
  },
  scale: {
    included: [
      'Everything in Momentum',
      '30 AI Commercial Videos per month (6-sec, daily cadence)',
      '60 AI Hero Images per month (2K)',
      'Human creative review on every commercial drop',
      'White-label deployment for your agency',
      'Dedicated strategist + priority support'
    ],
    locked: []
  }
};
