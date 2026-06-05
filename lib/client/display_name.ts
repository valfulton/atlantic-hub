/**
 * lib/client/display_name.ts
 *
 * The "Good morning, Central." bug, fixed at the source.
 *
 * Background — every client surface used to read the greeting first word as:
 *   firstName = user.display_name?.split(/[ ,]/)[0] || 'there'
 * But when a client got created without a contact name, our create flow was
 * stuffing the COMPANY name into display_name as a fallback. Result: a brand
 * named "Central Bottle Brunch" with no contact would render every greeting
 * as "Good morning, Central." across every client page.
 *
 * Two-part defense, applied EVERYWHERE that picks a greeting name:
 *  1. createClientFromOperator no longer falls back to company name — if the
 *     operator didn't type a contact name, display_name is NULL. Better to
 *     greet "there" than to address the human by their brand.
 *  2. This helper guards the read side: if display_name happens to match or
 *     start with the brand name (legacy data, intake form drift, anything),
 *     it's treated as "no real contact yet" and the caller's fallback wins.
 *
 * Use safeFirstName() ANYWHERE a greeting is rendered. Never read
 * display_name.split() directly again.
 */

/**
 * Returns the operator-typed contact first name when one is present and is
 * NOT the brand name in disguise. Returns null otherwise so the caller can
 * use its own friendly fallback ('there', 'friend', etc.) instead of
 * accidentally calling the human by their company.
 *
 * Examples:
 *   safeFirstName('Adriana Rojas', 'Central Bottle Brunch') -> 'Adriana'
 *   safeFirstName('Central Bottle Brunch', 'Central Bottle Brunch') -> null
 *   safeFirstName('Central', 'Central Bottle Brunch') -> null  (prefix match)
 *   safeFirstName(null, 'Acme Corp') -> null
 *   safeFirstName('there', 'Acme Corp') -> null  (sentinel/legacy)
 *   safeFirstName('Pat Acme', 'Acme Corp') -> 'Pat'
 */
// Common tokens that mark a string as a company name (not a person's name).
// "Timothy Helfrey" contains none of these → person. "Acme Holdings LLC" does → company.
const COMPANY_TOKENS = new Set([
  'llc', 'inc', 'corp', 'corporation', 'ltd', 'limited', 'co', 'company',
  'group', 'holdings', 'partners', 'lp', 'llp', 'pllc', 'pc', 'pa',
  'services', 'consulting', 'enterprises', 'industries', 'technologies',
  'tech', 'solutions', 'systems', 'international', 'global', 'agency',
  'studio', 'studios', 'collective', 'lab', 'labs', 'works', 'media'
]);

/**
 * Heuristic: does displayName clearly look like a real person's name?
 * Person names are 2-4 tokens, each starts with a capital letter, no obvious
 * company tokens. When this returns true, we trust displayName as a person
 * even if it happens to match the brand (which is the Tim Helfrey case —
 * brand was set to his name during onboarding).
 */
function looksLikePersonName(s: string): boolean {
  const tokens = s.split(/[\s,]+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false;
  for (const t of tokens) {
    const stripped = t.toLowerCase().replace(/\.$/, '');
    if (COMPANY_TOKENS.has(stripped)) return false;
    // Must look like a name part: leading capital, then letters/apostrophes/hyphens.
    if (!/^[A-Z][a-zA-Z'’-]+$/.test(t)) return false;
  }
  return true;
}

export function safeFirstName(
  displayName: string | null | undefined,
  brandName: string | null | undefined
): string | null {
  const d = (displayName ?? '').trim();
  if (!d) return null;

  // Sentinel placeholders we used in older intake flows — never a real name.
  const LOWER_SENTINELS = new Set(['there', 'friend', 'client', 'unknown', '-', 'n/a']);
  if (LOWER_SENTINELS.has(d.toLowerCase())) return null;

  const first = d.split(/[\s,]+/).filter(Boolean)[0] ?? '';
  if (!first) return null;

  // Trust-the-person override: if displayName clearly looks like a personal
  // name (2-4 properly-capitalized tokens with no company suffixes), believe
  // it even when it matches the brand. This catches the Tim Helfrey case
  // where the client was onboarded with the contact's name as the brand and
  // safeFirstName otherwise vetoes it as "brand stuffed in display_name".
  // The Central-Bottle-Brunch bug remains caught for single-token displayNames
  // and for multi-token display_names containing clear company markers.
  if (looksLikePersonName(d)) return first;

  const brand = (brandName ?? '').trim();
  if (brand) {
    const dNorm = d.toLowerCase();
    const bNorm = brand.toLowerCase();
    // Exact brand match — display_name was stuffed with the company name.
    if (dNorm === bNorm) return null;
    // display_name is a prefix of the brand (e.g. "Central" inside
    // "Central Bottle Brunch"). Same bug, different shape.
    if (bNorm.startsWith(dNorm) || bNorm.split(/[\s,]+/)[0] === dNorm) return null;
  }

  return first;
}

/**
 * Convenience for the greeting: returns the contact first name OR the
 * provided fallback ("there" / "friend" / etc).
 */
export function greetingName(
  displayName: string | null | undefined,
  brandName: string | null | undefined,
  fallback: string = 'there'
): string {
  return safeFirstName(displayName, brandName) ?? fallback;
}

/**
 * Server-side convenience: resolve a safe greeting name in one call. Pages
 * pass the user's display_name + their active client_id; we look up the brand
 * name and apply safeFirstName. Falls back gracefully when clientId is null
 * or the DB lookup fails. Use this everywhere a /client/* page renders a
 * greeting — keeps the bug pinned in one place.
 */
export async function resolveGreetingName(
  displayName: string | null | undefined,
  clientId: number | null | undefined,
  fallback: string = 'there'
): Promise<string> {
  let brandName: string | null = null;
  if (clientId) {
    try {
      const { getAvDb } = await import('@/lib/db/av');
      const db = getAvDb();
      const [rows] = await db.execute(
        `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
        [clientId]
      );
      const r = (rows as Array<{ client_name: string | null }>)[0];
      brandName = r?.client_name ?? null;
    } catch {
      /* fallback wins */
    }
  }
  return greetingName(displayName, brandName, fallback);
}
