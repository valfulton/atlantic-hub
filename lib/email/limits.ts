/**
 * lib/email/limits.ts
 *
 * Tier-aware daily send caps for the outreach pipeline.
 *
 * Source of truth for tier names: lib/client-portal/tiers.ts
 * Audit-only and trial users get a tight cap; paid tiers scale with the
 * package. Operator (val) has no tier and is treated as unlimited at
 * this layer -- per-mailbox and per-campaign caps still apply.
 *
 * These defaults match docs/CLAUDE_EMAIL_AUTOMATION_CORRECTION_NOTE.md
 * (2026-05-17). Make them configurable per campaign in the UI -- this
 * file just provides the defaults.
 */

import type { ClientTier } from '@/lib/client-portal/tiers';

export type TierForLimits = ClientTier | 'trial' | 'operator';

export interface SendLimitCheck {
  allowed: boolean;
  cap: number;
  current: number;
  reason?: string;
}

export const TIER_DAILY_SEND_CAP: Record<TierForLimits, number> = {
  operator: Number.POSITIVE_INFINITY, // val sends as the operator -- per-mailbox cap still applies
  audit_only: 0,
  trial: 5,
  sprint: 25,
  momentum: 75,
  scale: 200
};

export function tierDailyCap(tier: TierForLimits): number {
  return TIER_DAILY_SEND_CAP[tier] ?? 0;
}

export function checkTierCap(args: {
  tier: TierForLimits;
  sentToday: number;
}): SendLimitCheck {
  const cap = tierDailyCap(args.tier);
  if (args.sentToday >= cap) {
    return {
      allowed: false,
      cap,
      current: args.sentToday,
      reason:
        cap === 0
          ? `Outbound sends are not included on the ${args.tier} plan`
          : `Daily send cap reached (${args.sentToday}/${cap}) for the ${args.tier} plan`
    };
  }
  return { allowed: true, cap, current: args.sentToday };
}

export function checkCampaignCap(args: {
  campaignLimit: number;
  sentTodayInCampaign: number;
}): SendLimitCheck {
  if (args.sentTodayInCampaign >= args.campaignLimit) {
    return {
      allowed: false,
      cap: args.campaignLimit,
      current: args.sentTodayInCampaign,
      reason: `Campaign daily cap reached (${args.sentTodayInCampaign}/${args.campaignLimit})`
    };
  }
  return { allowed: true, cap: args.campaignLimit, current: args.sentTodayInCampaign };
}
