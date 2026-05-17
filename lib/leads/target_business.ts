/**
 * lib/leads/target_business.ts
 *
 * Single source of truth for deciding which business pipeline (AV, EBW, or
 * both) a newly-discovered lead belongs to.
 *
 * Heuristic (May 2026): hospitality businesses — restaurants, hotels/resorts
 * mapped as 'corporate_retreat', wedding planners — get 'both' because they
 * plausibly buy Atlantic & Vine marketing services AND book Events by Water
 * charters / corporate retreats. Everything else defaults to 'av' (the
 * agency tenant) since AV is the primary lead-gen surface.
 *
 * Used by: Apollo discoverer, Google Places discoverer, Apify Instagram
 * discoverer, manual insert paths, CSV import.
 *
 * The PATCH /api/admin/av/leads/[audit_id] endpoint accepts a manual
 * targetBusiness override — so this heuristic is the DEFAULT, not the law.
 */

export type TargetBusiness = 'av' | 'ebw' | 'both';

const HOSPITALITY_SLUGS = new Set<string>([
  'wedding_planner',
  'restaurant',
  'corporate_retreat'
]);

const HOSPITALITY_KEYWORDS = [/hotel/i, /resort/i, /hospitality/i, /marina/i, /bar/i];

/**
 * Decide target_business for a lead given its normalized industry slug.
 * Pass the slug AFTER running it through lib/apollo/search.ts:normalizeIndustry
 * (or an equivalent) so it matches the controlled vocabulary used in the DB.
 *
 * Falls back to 'av' for anything we can't classify confidently.
 */
export function inferTargetBusiness(industry: string | null | undefined): TargetBusiness {
  if (!industry) return 'av';
  const lower = industry.toLowerCase();
  if (HOSPITALITY_SLUGS.has(lower)) return 'both';
  if (HOSPITALITY_KEYWORDS.some((re) => re.test(lower))) return 'both';
  return 'av';
}

/**
 * Same heuristic but accepts a RAW industry string (e.g. Apollo's
 * 'Hotels & Resorts' before normalization). Useful for Google Places where
 * we have raw category names like 'restaurant' / 'lodging'.
 */
export function inferTargetBusinessFromRaw(rawIndustry: string | null | undefined): TargetBusiness {
  if (!rawIndustry) return 'av';
  const lower = rawIndustry.toLowerCase();
  if (/wedding|event\s*plan/.test(lower)) return 'both';
  if (/restaurant|food\s*service|bar|brewery|cafe/.test(lower)) return 'both';
  if (/hotel|resort|lodg|accommodation|inn\b|bed\s*and\s*breakfast|b&b/.test(lower)) return 'both';
  if (/marina|yacht\s*club|dock/.test(lower)) return 'both';
  return 'av';
}

export const ALL_TARGETS: readonly TargetBusiness[] = ['av', 'ebw', 'both'] as const;

export function isTargetBusiness(v: unknown): v is TargetBusiness {
  return v === 'av' || v === 'ebw' || v === 'both';
}
