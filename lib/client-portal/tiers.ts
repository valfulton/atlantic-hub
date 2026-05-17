/**
 * Tier feature matrix for the client portal.
 *
 * Source of truth for what's "included" at each tier vs. "locked behind
 * an upgrade". Used by both /api/client/me (JSON for ad-hoc clients) and
 * the server-rendered /client/dashboard page.
 *
 * Edit here, both surfaces update. Pricing copy is duplicated from
 * atlanticandvine.netlify.app/#pricing - keep in sync when prices change.
 */
export type ClientTier = 'audit_only' | 'starter' | 'growth' | 'scale';

export interface TierLockedFeature {
  name: string;
  tier: 'Starter' | 'Growth' | 'Scale';
}

export interface TierFeatures {
  included: string[];
  locked: TierLockedFeature[];
}

export const TIER_LABEL: Record<ClientTier, string> = {
  audit_only: 'Free Audit',
  starter: 'Starter',
  growth: 'Growth',
  scale: 'Scale'
};

export const TIER_PRICE_HINT: Record<ClientTier, string> = {
  audit_only: 'Free',
  starter: '$497/mo',
  growth: '$1,497/mo',
  scale: '$3,997/mo'
};

export const TIER_FEATURES: Record<ClientTier, TierFeatures> = {
  audit_only: {
    included: [
      'AI-generated Strategic Marketing Audit',
      'Portal access with your audit always available'
    ],
    locked: [
      { name: 'Multi-source lead discovery (Apollo + Places + Instagram)', tier: 'Starter' },
      { name: 'AI lead scoring with Hot/Warm/Cool bands', tier: 'Starter' },
      { name: 'Automated email enrichment via Hunter.io', tier: 'Starter' },
      { name: 'CSV import + bulk pipeline management', tier: 'Starter' },
      { name: 'AI social-content generation (LinkedIn + X + Instagram)', tier: 'Growth' },
      { name: 'Email outreach automation with reply tracking', tier: 'Growth' },
      { name: 'AI commercial generation (scripts, images, video)', tier: 'Scale' },
      { name: 'White-label deployment for your agency', tier: 'Scale' }
    ]
  },
  starter: {
    included: [
      'AI-generated Strategic Marketing Audit',
      'Multi-source lead discovery (Apollo + Places + Instagram)',
      'AI lead scoring with Hot/Warm/Cool bands',
      'Automated email enrichment via Hunter.io',
      'CSV import + bulk pipeline management',
      'Portal access with your audit + leads always available'
    ],
    locked: [
      { name: 'AI social-content generation (LinkedIn + X + Instagram)', tier: 'Growth' },
      { name: 'Email outreach automation with reply tracking', tier: 'Growth' },
      { name: 'AI commercial generation (scripts, images, video)', tier: 'Scale' },
      { name: 'White-label deployment for your agency', tier: 'Scale' }
    ]
  },
  growth: {
    included: [
      'Everything in Starter',
      'AI social-content generation (LinkedIn + X + Instagram)',
      'Email outreach automation with reply tracking',
      'Advanced pipeline analytics'
    ],
    locked: [
      { name: 'AI commercial generation (scripts, images, video)', tier: 'Scale' },
      { name: 'White-label deployment for your agency', tier: 'Scale' }
    ]
  },
  scale: {
    included: [
      'Everything in Growth',
      'AI commercial generation (scripts, images, video)',
      'White-label deployment for your agency',
      'Dedicated strategist + priority support'
    ],
    locked: []
  }
};
