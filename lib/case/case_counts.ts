/**
 * case_counts.ts — single source of truth for the "needs you" count badge.
 *
 * Beauty Pack v1 (val 2026-06-14): the garnet count number must be IDENTICAL
 * on the dashboard "Your matters" card AND on the nav Matters tab AND on any
 * case list row. To enforce that, every surface reads this helper.
 *
 * Scope rule:
 *   - If a viewer is a parent / non-account_rep collaborator, count only
 *     parents_safe items they're allowed to see.
 *   - If a viewer is an account_rep / professional with full access, count
 *     parents_safe + operator_only.
 *   - In all cases: only OPEN items (status = 'open'). Done/blocked don't count.
 *
 * Soft-fails to 0 — the count is decorative; never block render on it.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';
import { resolveCaseViewerRole, visibleFor, type CaseViewerRole } from './case_collaborators';

interface CountRow extends RowDataPacket {
  open_count: number;
}

/**
 * Count open action items on ONE case for ONE viewer, honoring the visibility
 * filter that already gates the case detail page.
 */
export async function openActionItemCountForUserCase(
  clientUserId: number,
  caseId: number,
  caseClientId: number | null
): Promise<number> {
  if (!Number.isInteger(clientUserId) || clientUserId <= 0) return 0;
  if (!Number.isInteger(caseId) || caseId <= 0) return 0;
  try {
    const role = await resolveCaseViewerRole(clientUserId, caseId, caseClientId);
    const visibilities = visibleFor(role);
    if (!visibilities.length) return 0;

    const db = getAvDb();
    const placeholders = visibilities.map(() => '?').join(',');
    const [rows] = await db.execute<CountRow[]>(
      `SELECT COUNT(*) AS open_count
         FROM case_action_items
        WHERE case_id = ?
          AND status = 'open'
          AND visibility IN (${placeholders})`,
      [caseId, ...visibilities]
    );
    return Number(rows[0]?.open_count ?? 0);
  } catch (err) {
    console.error('openActionItemCountForUserCase failed', err);
    return 0;
  }
}

/**
 * Total open action items across EVERY case a viewer can access — what the
 * Matters nav tab badge displays. Sums the per-case helper.
 */
export async function openActionItemCountForUserAllCases(
  clientUserId: number,
  primaryClientId: number | null,
  caseList: { caseId: number; clientId: number }[]
): Promise<number> {
  if (!Number.isInteger(clientUserId) || clientUserId <= 0) return 0;
  if (!caseList.length) return 0;
  try {
    const counts = await Promise.all(
      caseList.map((c) => openActionItemCountForUserCase(clientUserId, c.caseId, c.clientId))
    );
    return counts.reduce((sum, n) => sum + n, 0);
  } catch (err) {
    console.error('openActionItemCountForUserAllCases failed', err);
    return 0;
  }
}

/** Re-export for downstream loaders that want the resolved role too. */
export type { CaseViewerRole };
