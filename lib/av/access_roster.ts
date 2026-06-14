/**
 * lib/av/access_roster.ts  (val 2026-06-12)
 *
 * Listing of EVERY login that can access a given client's portal. This is the
 * "Access Roster" panel on /admin/av/clients/[id] — answers "who has logins
 * to this client, what's their current magic link, is it expired?".
 *
 * Three sources are unioned:
 *   1. Direct client_users (client_users.client_id = ?)
 *   2. Brand members (brand_members.client_id = ? joining to a client_user
 *      whose primary client_id is different — i.e. owners who span brands)
 *   3. Family case collaborators (family_case_collaborators on a case that
 *      belongs to this client — Adriana-as-attorney style cross-brand access)
 *
 * Output: one row per (clientUserId, origin) combination. We dedup by
 * clientUserId so a single person doesn't appear in multiple sections when
 * they have both direct + collaborator access.
 *
 * NEVER expose the raw magic_token in API responses — callers should use the
 * issueFreshMagicLink helper which mints a new token AND returns the full URL.
 * This helper returns the EXPIRY only, plus a "linkStatus" enum, so val knows
 * whether to regenerate before sending.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { generateMagicToken, magicTokenExpiresAt, buildMagicLinkUrl } from '@/lib/auth/client-magic-token';

export type AccessOrigin = 'primary' | 'brand_member' | 'case_collaborator';
export type LinkStatus = 'active' | 'expired' | 'never_issued';

export interface AccessRosterEntry {
  clientUserId: number;
  email: string;
  displayName: string | null;
  origin: AccessOrigin;
  /** For case_collaborator: the role on the case (attorney, primary_caregiver, etc). */
  contextNote: string | null;
  linkStatus: LinkStatus;
  /** ISO string; null when never issued or already cleared. */
  magicTokenExpiresAt: string | null;
  lastLoginAt: string | null;
  createdAt: string | null;
  archivedAt: string | null;
}

interface RosterRow extends RowDataPacket {
  client_user_id: number;
  email: string;
  display_name: string | null;
  origin: AccessOrigin;
  context_note: string | null;
  magic_token: string | null;
  magic_token_expires_at: Date | string | null;
  last_login_at: Date | string | null;
  created_at: Date | string | null;
  archived_at: Date | string | null;
}

function toIso(d: Date | string | null): string | null {
  if (!d) return null;
  if (typeof d === 'string') return d;
  try { return d.toISOString(); } catch { return null; }
}

function deriveLinkStatus(token: string | null, expires: Date | string | null): LinkStatus {
  if (!token) return 'never_issued';
  if (!expires) return 'never_issued';
  const expMs = typeof expires === 'string' ? new Date(expires).getTime() : expires.getTime();
  if (!Number.isFinite(expMs)) return 'never_issued';
  return expMs > Date.now() ? 'active' : 'expired';
}

/** Every login attached to this client + everyone with case-collaborator
 *  access across the client's cases. Sorted: active links first, then expired,
 *  then never-issued. Archived users are excluded entirely. */
export async function listAccessRosterForClient(clientId: number): Promise<AccessRosterEntry[]> {
  if (!Number.isInteger(clientId) || clientId <= 0) return [];
  try {
    const db = getAvDb();
    // Pull all three categories in one query via UNION ALL so the page only
    // makes one round trip. Then dedup by client_user_id in JS (collaborator
    // who also has primary access stays as 'primary' — that's the truest origin).
    const [rows] = await db.execute<RosterRow[]>(
      `SELECT cu.client_user_id, cu.email, cu.display_name,
              'primary' AS origin,
              NULL AS context_note,
              cu.magic_token, cu.magic_token_expires_at,
              cu.last_login_at, cu.created_at, cu.archived_at
         FROM client_users cu
        WHERE cu.client_id = ?
          AND cu.archived_at IS NULL

        UNION ALL

        SELECT cu.client_user_id, cu.email, cu.display_name,
               'brand_member' AS origin,
               NULL AS context_note,
               cu.magic_token, cu.magic_token_expires_at,
               cu.last_login_at, cu.created_at, cu.archived_at
          FROM brand_members bm
          JOIN client_users cu ON cu.client_user_id = bm.client_user_id
         WHERE bm.client_id = ?
           AND cu.archived_at IS NULL
           AND cu.client_id != ?   -- don't double-count the primary row

        UNION ALL

        SELECT cu.client_user_id, cu.email, cu.display_name,
               'case_collaborator' AS origin,
               fcc.role AS context_note,
               cu.magic_token, cu.magic_token_expires_at,
               cu.last_login_at, cu.created_at, cu.archived_at
          FROM family_case_collaborators fcc
          JOIN cases c ON c.case_id = fcc.case_id
          JOIN client_users cu ON cu.client_user_id = fcc.client_user_id
         WHERE c.client_id = ?
           AND fcc.revoked_at IS NULL
           AND cu.archived_at IS NULL`,
      [clientId, clientId, clientId, clientId]
    );

    // Dedup: keep the highest-priority origin per client_user_id
    // (primary > brand_member > case_collaborator).
    const priority: Record<AccessOrigin, number> = {
      primary: 0, brand_member: 1, case_collaborator: 2
    };
    const byUser = new Map<number, RosterRow>();
    for (const r of rows) {
      const existing = byUser.get(r.client_user_id);
      if (!existing || priority[r.origin] < priority[existing.origin]) {
        byUser.set(r.client_user_id, r);
      }
    }

    const out: AccessRosterEntry[] = Array.from(byUser.values()).map((r) => ({
      clientUserId: r.client_user_id,
      email: r.email,
      displayName: r.display_name,
      origin: r.origin,
      contextNote: r.context_note,
      linkStatus: deriveLinkStatus(r.magic_token, r.magic_token_expires_at),
      magicTokenExpiresAt: toIso(r.magic_token_expires_at),
      lastLoginAt: toIso(r.last_login_at),
      createdAt: toIso(r.created_at),
      archivedAt: toIso(r.archived_at)
    }));

    // Sort: active links first (need to be SENT), then expired (need refresh),
    // then never-issued (need first send), then by name.
    const statusRank: Record<LinkStatus, number> = { active: 0, expired: 1, never_issued: 2 };
    out.sort((a, b) => {
      const s = statusRank[a.linkStatus] - statusRank[b.linkStatus];
      if (s !== 0) return s;
      return (a.displayName || a.email).localeCompare(b.displayName || b.email);
    });
    return out;
  } catch (err) {
    console.error('listAccessRosterForClient failed', err);
    return [];
  }
}

/** Archive a client_user — kills the login entirely. Sets archived_at = NOW()
 *  and clears the magic_token. The user can no longer authenticate to ANY
 *  brand (their row is filtered out of all login queries by archived_at).
 *
 *  Use this for true "they should not have access anymore" — distinct from
 *  case-collaborator revoke which only scopes off one case while leaving the
 *  portal login intact. */
export async function archiveClientUser(clientUserId: number): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  if (!Number.isInteger(clientUserId) || clientUserId <= 0) {
    return { ok: false, error: 'invalid client_user_id' };
  }
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE client_users
          SET archived_at = NOW(),
              magic_token = NULL,
              magic_token_expires_at = NULL
        WHERE client_user_id = ?
          AND archived_at IS NULL`,
      [clientUserId]
    );
    if (!res.affectedRows) {
      return { ok: false, error: 'already archived or not found' };
    }
    return { ok: true };
  } catch (err) {
    console.error('archiveClientUser failed', err);
    return { ok: false, error: 'database error' };
  }
}

/** Mint a fresh magic_token for an existing client_user, set the 24h expiry,
 *  and return the full URL ready to copy/send. Used by the Regenerate button
 *  on each Access Roster row. */
export async function issueFreshMagicLink(clientUserId: number): Promise<
  | { ok: true; magicLinkUrl: string; expiresAt: string }
  | { ok: false; error: string }
> {
  if (!Number.isInteger(clientUserId) || clientUserId <= 0) {
    return { ok: false, error: 'invalid client_user_id' };
  }
  try {
    const db = getAvDb();
    const token = generateMagicToken();
    const expires = magicTokenExpiresAt();
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE client_users
          SET magic_token = ?,
              magic_token_expires_at = ?
        WHERE client_user_id = ?
          AND archived_at IS NULL`,
      [token, expires, clientUserId]
    );
    if (!res.affectedRows) {
      return { ok: false, error: 'client_user not found or archived' };
    }
    return {
      ok: true,
      magicLinkUrl: buildMagicLinkUrl(token),
      expiresAt: expires.toISOString()
    };
  } catch (err) {
    console.error('issueFreshMagicLink failed', err);
    return { ok: false, error: 'database error' };
  }
}
