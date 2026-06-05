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
