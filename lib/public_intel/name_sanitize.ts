/**
 * lib/public_intel/name_sanitize.ts
 *
 * Single source of truth for sanitizing names before they hit court /
 * public-record searches. Both the vertical-pack apply path and the
 * run-kyc-sweep endpoint import from here so they can't drift.
 *
 * Why this exists (val 2026-06-10):
 *   Court records list "Ronald Elfenbein", not "Dr. Ron Elfenbein — Defense
 *   Press". Without sanitization, CourtListener returns 0 hits for a doctor
 *   that has multiple active filings. Two code paths used to call court
 *   adapters with raw names; both now route through the helpers below.
 */

/** Strips honorifics like "Dr. " / "Prof. " / "Sen. " from the front. */
export const HONORIFICS_RX = /^(?:dr|mr|mrs|ms|prof|hon|rev|sen|rep)\.?\s+/i;

/** Strips trailing credential markers like ", MD" / ", PhD" / ", Esq." */
export const DEGREES_RX = /\s*,\s*(?:M\.?D\.?|Ph\.?D\.?|J\.?D\.?|Esq\.?|D\.?D\.?S\.?|D\.?O\.?)\s*$/i;

/**
 * Strips a trailing brand kicker — " — Defense Press" / " - Compass" / " | Family Brand".
 * Used on company labels where the entity name is followed by a marketing tagline.
 */
export const BRAND_KICKER_RX = /\s+[—\-|]\s+.+$/;

/** Strips a single-period middle initial — "John Q. White" → "John White". */
export const MIDDLE_INITIAL_RX = /\s+[A-Z]\.\s+/;

/**
 * Returns a person's name cleaned of honorifics + trailing degrees.
 * "Dr. Ron Elfenbein, MD" → "Ron Elfenbein".
 * Safe to call on empty strings — returns ''.
 */
export function sanitizePersonName(raw: string): string {
  let n = (raw ?? '').trim();
  if (!n) return '';
  // Loop honorifics in case of "Sen. Dr. ..." stacking.
  while (HONORIFICS_RX.test(n)) n = n.replace(HONORIFICS_RX, '');
  n = n.replace(DEGREES_RX, '');
  return n.trim();
}

/**
 * Returns a company/entity name cleaned of brand kickers + person sanitizers.
 * "Dr. Ron Elfenbein — Defense Press" → "Ron Elfenbein".
 * Safe to call on empty strings — returns ''.
 */
export function sanitizeCompanyName(raw: string): string {
  let n = (raw ?? '').trim();
  if (!n) return '';
  n = n.replace(BRAND_KICKER_RX, '');
  n = sanitizePersonName(n);
  return n.trim();
}

/**
 * Returns just the last token of a name, after dropping degree/suffix tokens.
 * "Ronald J. Elfenbein, MD" → "Elfenbein". Useful as a high-recall fallback
 * when the court filing might not match a full-name search.
 */
export function lastNameOnly(raw: string): string {
  const parts = (raw ?? '').trim().split(/\s+/);
  while (
    parts.length > 1 &&
    /^(?:M\.?D\.?|Ph\.?D\.?|J\.?D\.?|Esq\.?|D\.?D\.?S\.?|D\.?O\.?|Sr\.?|Jr\.?|II|III|IV)$/i.test(parts[parts.length - 1])
  ) {
    parts.pop();
  }
  return parts[parts.length - 1] ?? '';
}

/**
 * Dedup-aware append for person names: sanitizes the input, pushes the clean
 * full name (if novel), then pushes a last-name fallback (if it's a distinct
 * meaningful token > 2 chars). Mutates `out` + `seenLc`.
 */
export function addPersonName(out: string[], seenLc: Set<string>, raw: string): void {
  const cleaned = sanitizePersonName(raw);
  if (!cleaned) return;
  const lc = cleaned.toLowerCase();
  if (!seenLc.has(lc)) { seenLc.add(lc); out.push(cleaned); }
  const ln = lastNameOnly(cleaned);
  if (ln && ln.length > 2) {
    const lcLn = ln.toLowerCase();
    if (lcLn !== lc && !seenLc.has(lcLn)) { seenLc.add(lcLn); out.push(ln); }
  }
}

/**
 * Dedup-aware append for company names: sanitizes, pushes if novel.
 * Mutates `out` + `seenLc`.
 */
export function addCompanyName(out: string[], seenLc: Set<string>, raw: string): void {
  const cleaned = sanitizeCompanyName(raw);
  if (!cleaned) return;
  const lc = cleaned.toLowerCase();
  if (!seenLc.has(lc)) { seenLc.add(lc); out.push(cleaned); }
}
