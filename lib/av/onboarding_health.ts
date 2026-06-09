/**
 * lib/av/onboarding_health.ts
 *
 * Operator-facing onboarding health check for the client roster. Catches the
 * two ways a client can be created "incomplete" and silently unable to use the
 * hub the way the happy path intends:
 *
 *   1. NO MEMBERSHIP — a `clients` row with no `brand_members` row. The
 *      /api/admin/av/clients/create endpoint always inserts one (setBrandMember,
 *      #101), but a client onboarded by ad-hoc SQL bypasses that and lands
 *      brand-less. Such a brand gets the column-default engagement_kind and the
 *      dashboard/intake kind-routing can't resolve a real engagement for it.
 *      (This is exactly how Elfenbein + The Flame ended up untagged.)
 *
 *   2. PLACEHOLDER EMAIL — the brand's login uses a stand-in address (e.g.
 *      foo@example.com, x@placeholder.local). The magic-link / login flow can't
 *      actually reach the client until a real email is set.
 *
 * Pure read; degrades to {} on error so it never breaks the roster.
 *
 * The placeholder heuristic is deliberately CONSERVATIVE (clear stand-ins only)
 * to avoid false-flagging real clients. Tune PLACEHOLDER_MARKERS to val's exact
 * onboarding convention.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export interface OnboardingHealth {
  /** No brand_members row → login can't be scoped to the brand. */
  noMembership: boolean;
  /** The login email if it looks like a placeholder, else null. */
  placeholderEmail: string | null;
}

// Clear stand-in domains/markers only. Real client domains never match these.
const PLACEHOLDER_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'test.com', 'placeholder.com'
]);
const PLACEHOLDER_TLDS = ['.local', '.invalid', '.test', '.example'];
// val's hand-run SQL onboarding conventions (matched case-insensitively):
//   PLACEHOLDER_*@example.com   (e.g. PLACEHOLDER_ron@example.com)
//   REPLACE_WITH_*@example.com  (e.g. REPLACE_WITH_KEVIN_OR_MAILE_EMAIL@example.com)
// Both always end @example.com (already in PLACEHOLDER_DOMAINS); the prefix
// markers below catch them even if the domain ever differs.
const PLACEHOLDER_MARKERS = ['placeholder_', 'replace_with', 'placeholder', 'noemail', 'no-reply', 'noreply', 'donotreply'];

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (!e.includes('@')) return false;
  const [local, domain = ''] = e.split('@');
  if (PLACEHOLDER_DOMAINS.has(domain)) return true;
  if (PLACEHOLDER_TLDS.some((t) => domain.endsWith(t))) return true;
  if (PLACEHOLDER_MARKERS.some((m) => local.includes(m) || domain.includes(m))) return true;
  return false;
}

/**
 * Onboarding health for every non-archived brand that has a problem. Only
 * flagged brands appear in the map; a brand absent from the map is healthy.
 */
export async function onboardingHealthByClient(): Promise<Record<number, OnboardingHealth>> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & {
      client_id: number;
      members: number;
      first_email: string | null;
    })[]>(
      `SELECT c.client_id,
              (SELECT COUNT(*) FROM brand_members bm WHERE bm.client_id = c.client_id) AS members,
              (SELECT cu.email FROM client_users cu
                WHERE cu.client_id = c.client_id AND cu.archived_at IS NULL
                ORDER BY cu.client_user_id ASC LIMIT 1) AS first_email
         FROM clients c
        WHERE c.archived_at IS NULL`
    );
    const out: Record<number, OnboardingHealth> = {};
    for (const r of rows) {
      const noMembership = Number(r.members) === 0;
      const placeholderEmail = isPlaceholderEmail(r.first_email) ? r.first_email : null;
      if (noMembership || placeholderEmail) {
        out[Number(r.client_id)] = { noMembership, placeholderEmail };
      }
    }
    return out;
  } catch (err) {
    console.error('[onboarding_health]', (err as Error).message);
    return {};
  }
}
