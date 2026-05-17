/**
 * lib/leads/dedup.ts
 *
 * Cross-source lead dedup. Every discovery source (Apollo, Google Places,
 * Instagram, contact-page scrape, CSV import, manual) routes new inserts
 * through this module so we don't end up with five rows for the same hotel.
 *
 * Strategy: match by normalized_domain first (most reliable), then by
 * normalized phone if no domain available. Returns the existing lead id
 * on hit so the caller can either skip the insert or merge fields.
 *
 * normalizeDomain stripping rules (kept in sync with the SQL backfill in
 * schema/008_target_business.sql):
 *   - lowercase
 *   - drop http:// or https://
 *   - drop leading 'www.'
 *   - drop everything from the first '/' or '?' onward
 *   - drop trailing whitespace and dots
 *   - empty string → null (so the unique constraint can hold many nulls)
 */

import type { Pool, RowDataPacket } from 'mysql2/promise';

export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  // strip protocol
  s = s.replace(/^https?:\/\//, '');
  // strip leading www.
  s = s.replace(/^www\./, '');
  // cut at first / or ? (path/query)
  const slashIdx = s.indexOf('/');
  if (slashIdx >= 0) s = s.slice(0, slashIdx);
  const queryIdx = s.indexOf('?');
  if (queryIdx >= 0) s = s.slice(0, queryIdx);
  // trim trailing dots / spaces
  s = s.replace(/[.\s]+$/, '');
  if (!s || !s.includes('.')) return null;
  return s;
}

/**
 * Strip a phone number to digits only. '+1 (340) 555-0100' → '13405550100'.
 * Used as a fallback dedup key when the lead has no domain.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D+/g, '');
  if (digits.length < 7) return null;
  return digits;
}

export interface DedupMatch {
  leadId: number;
  matchedOn: 'normalized_domain' | 'phone';
  /** Existing target_business — caller may want to upgrade from 'av' to 'both'. */
  targetBusiness?: 'av' | 'ebw' | 'both';
}

interface LeadDedupRow extends RowDataPacket {
  id: number;
  target_business: 'av' | 'ebw' | 'both';
}

/**
 * Find an existing (non-archived) lead matching either domain or phone.
 * Returns null if nothing matches — caller proceeds with INSERT.
 *
 * NOTE: phone match is intentionally weaker than domain match. If you only
 * have a phone and no domain, it's a hint not a contract — pass mode='strict'
 * to only match by domain.
 */
export async function findExistingLead(
  db: Pool,
  args: { domain: string | null; phone: string | null; mode?: 'strict' | 'loose' }
): Promise<DedupMatch | null> {
  const mode = args.mode ?? 'loose';
  const normDomain = normalizeDomain(args.domain);
  const normPhone = normalizePhone(args.phone);

  if (normDomain) {
    const [rows] = await db.execute<LeadDedupRow[]>(
      `SELECT id, target_business FROM leads
       WHERE normalized_domain = ? AND archived_at IS NULL
       ORDER BY id ASC
       LIMIT 1`,
      [normDomain]
    );
    if (rows.length > 0) {
      return { leadId: rows[0].id, matchedOn: 'normalized_domain', targetBusiness: rows[0].target_business };
    }
  }

  if (mode === 'loose' && normPhone) {
    // Strip non-digits in SQL too. MariaDB doesn't have regex_replace pre-10.0,
    // so we use REPLACE chains. Close enough for triage.
    const [rows] = await db.execute<LeadDedupRow[]>(
      `SELECT id, target_business FROM leads
       WHERE archived_at IS NULL
         AND phone IS NOT NULL
         AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), '-', ''), '(', ''), ')', ''), ' ', ''), '.', '') = ?
       ORDER BY id ASC
       LIMIT 1`,
      [normPhone]
    );
    if (rows.length > 0) {
      return { leadId: rows[0].id, matchedOn: 'phone', targetBusiness: rows[0].target_business };
    }
  }

  return null;
}

/**
 * Merge target_business when a discovery source finds an existing lead.
 * If the new source thinks this is 'both' but the lead is currently 'av',
 * promote it to 'both' (notes become visible from /admin/ebw too).
 * Never downgrades.
 */
export function mergeTargetBusiness(
  existing: 'av' | 'ebw' | 'both',
  incoming: 'av' | 'ebw' | 'both'
): 'av' | 'ebw' | 'both' {
  if (existing === 'both' || incoming === 'both') return 'both';
  if (existing !== incoming) return 'both';
  return existing;
}
