/**
 * lib/client/pr_access.ts  (#579, val 2026-06-10)
 *
 * Single source of truth for "should the press queue render or show the
 * upgrade gate?" Used by /client/pr and the /admin/av/clients/[id]/preview/pr
 * mirror so they can't drift from each other again.
 *
 * The bug val flagged:
 *   Ron is a paying defense_pr client. The press desk is the whole product.
 *   But the gate was just `tier === 'audit_only' || tier === 'sprint'` —
 *   so Ron's preview rendered "Press opportunities unlock on Momentum,"
 *   which is wrong: defense_pr's value proposition IS press. Gating press
 *   on a tier when the engagement requires press is a self-contradiction.
 *
 * The rule:
 *   - lead_gen engagements on audit_only / sprint  → gate (today's behavior)
 *   - defense_pr / political_campaign / luxury_hospitality / book_pr →
 *     never gate. Press IS what they bought. Tier still controls everything
 *     else (lead caps, integrations, etc.), but never the press desk.
 *
 * Returns isLocked + reason so the caller can render the right copy.
 */
import type { EngagementKind } from '@/lib/client/engagement_kind';

export type ClientTier = 'audit_only' | 'sprint' | 'momentum' | 'velocity' | string;

/** Engagement kinds whose product IS the press desk. They never see a
 *  press-queue paywall regardless of tier. */
const PRESS_ESSENTIAL_KINDS = new Set<EngagementKind>([
  'defense_pr',
  'political_campaign',
  'luxury_hospitality',
  'book_pr'
]);

export interface PressDeskAccess {
  locked: boolean;
  /** Short reason string. UIs render their own copy based on the kind+tier. */
  reason: 'press_essential_kind' | 'paid_plan' | 'free_tier_gated';
}

/**
 * Decide whether the press desk should be gated for this client.
 *
 * Order of checks:
 *   1. If engagement_kind is press-essential → ALWAYS unlocked.
 *   2. Else if tier is free (audit_only / sprint) → locked.
 *   3. Else (momentum / velocity / anything paid) → unlocked.
 */
export function evaluatePressDeskAccess(args: {
  tier: ClientTier;
  engagementKind: EngagementKind;
}): PressDeskAccess {
  if (PRESS_ESSENTIAL_KINDS.has(args.engagementKind)) {
    return { locked: false, reason: 'press_essential_kind' };
  }
  const isFree = args.tier === 'audit_only' || args.tier === 'sprint';
  return isFree
    ? { locked: true, reason: 'free_tier_gated' }
    : { locked: false, reason: 'paid_plan' };
}
