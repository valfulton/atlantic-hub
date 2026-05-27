/**
 * lib/client/membership.ts
 *
 * The person<->brand membership layer for multi-brand accounts (task #101).
 * One login (client_user) can belong to many brands (clients) with a role:
 *   owner  -> sees every brand they own + the merged calendar across them, one bill.
 *   rep    -> a salesperson on the brand; sees that brand's whole calendar/pipeline.
 *   viewer -> read-only.
 *
 * Brands stay their own client_id scopes (brief / ICP / narrative lines / leads /
 * calendar all key on client_id). This module only resolves WHICH brands a login
 * can see and in WHAT role, so the hub can offer a brand switcher and widen the
 * calendar/pipeline queries from a single client_id to "the set this person sees."
 *
 * Backed by schema/058_brand_members.sql. Reads degrade to [] on error.
 * See Atlantic_Hub_Playbook/Architecture_MultiBrand_Accounts.md.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export type BrandRole = 'owner' | 'rep' | 'viewer';
const ROLES: BrandRole[] = ['owner', 'rep', 'viewer'];
function isRole(v: unknown): v is BrandRole {
  return v === 'owner' || v === 'rep' || v === 'viewer';
}

export interface BrandMembership {
  /** The brand's client_id (its own scope). */
  clientId: number;
  clientName: string | null;
  role: BrandRole;
}

/**
 * Every brand this login belongs to, with the brand name + the person's role.
 * Owners first, then reps, then viewers; alphabetical within a role. Excludes
 * archived brands. Empty when the person has no memberships (caller falls back
 * to client_users.client_id — single-brand behavior).
 */
export async function listBrandsForUser(clientUserId: number): Promise<BrandMembership[]> {
  if (!Number.isInteger(clientUserId) || clientUserId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { client_id: number; client_name: string | null; role: BrandRole })[]>(
      `SELECT bm.client_id, c.client_name, bm.role
         FROM brand_members bm
         JOIN clients c ON c.client_id = bm.client_id
        WHERE bm.client_user_id = ? AND c.archived_at IS NULL
        ORDER BY FIELD(bm.role,'owner','rep','viewer'), c.client_name ASC`,
      [clientUserId]
    );
    return rows.map((r) => ({
      clientId: Number(r.client_id),
      clientName: r.client_name,
      role: isRole(r.role) ? r.role : 'rep'
    }));
  } catch (err) {
    console.error('[membership:listBrandsForUser]', (err as Error).message);
    return [];
  }
}

/**
 * The client_ids this login can SEE — used to widen calendar/pipeline queries
 * from a single brand to the whole set. Owners + reps + viewers all "see" their
 * brand's calendar (per the decision: more eyes on the calendar the better).
 */
export async function visibleBrandIds(clientUserId: number): Promise<number[]> {
  const memberships = await listBrandsForUser(clientUserId);
  return memberships.map((m) => m.clientId);
}

/** The brands this login OWNS (the merged-calendar + billing scope). */
export async function ownedBrandIds(clientUserId: number): Promise<number[]> {
  const memberships = await listBrandsForUser(clientUserId);
  return memberships.filter((m) => m.role === 'owner').map((m) => m.clientId);
}

/** The person's role on a specific brand, or null if not a member. */
export async function roleForBrand(clientUserId: number, clientId: number): Promise<BrandRole | null> {
  if (!Number.isInteger(clientUserId) || !Number.isInteger(clientId)) return null;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { role: BrandRole })[]>(
      `SELECT role FROM brand_members WHERE client_user_id = ? AND client_id = ? LIMIT 1`,
      [clientUserId, clientId]
    );
    const role = rows[0]?.role;
    return isRole(role) ? role : null;
  } catch (err) {
    console.error('[membership:roleForBrand]', (err as Error).message);
    return null;
  }
}

export async function isBrandOwner(clientUserId: number, clientId: number): Promise<boolean> {
  return (await roleForBrand(clientUserId, clientId)) === 'owner';
}

/** Can this login see this brand at all (any role)? */
export async function canSeeBrand(clientUserId: number, clientId: number): Promise<boolean> {
  return (await roleForBrand(clientUserId, clientId)) != null;
}

/**
 * Add or re-role a membership (idempotent on the unique (client_user_id, client_id)).
 * Returns true on success.
 */
export async function setBrandMember(
  clientUserId: number,
  clientId: number,
  role: BrandRole = 'rep'
): Promise<boolean> {
  if (!Number.isInteger(clientUserId) || clientUserId <= 0) return false;
  if (!Number.isInteger(clientId) || clientId <= 0) return false;
  const safeRole: BrandRole = ROLES.includes(role) ? role : 'rep';
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `INSERT INTO brand_members (client_user_id, client_id, role)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE role = VALUES(role), updated_at = NOW()`,
      [clientUserId, clientId, safeRole]
    );
    return true;
  } catch (err) {
    console.error('[membership:setBrandMember]', (err as Error).message);
    return false;
  }
}

export async function removeBrandMember(clientUserId: number, clientId: number): Promise<boolean> {
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `DELETE FROM brand_members WHERE client_user_id = ? AND client_id = ?`,
      [clientUserId, clientId]
    );
    return true;
  } catch (err) {
    console.error('[membership:removeBrandMember]', (err as Error).message);
    return false;
  }
}

export interface BrandMember {
  clientUserId: number;
  email: string;
  displayName: string | null;
  role: BrandRole;
}

/** Everyone on a brand (the team roster for that brand). Owners first. */
export async function listBrandMembers(clientId: number): Promise<BrandMember[]> {
  if (!Number.isInteger(clientId) || clientId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { client_user_id: number; email: string; display_name: string | null; role: BrandRole })[]>(
      `SELECT bm.client_user_id, cu.email, cu.display_name, bm.role
         FROM brand_members bm
         JOIN client_users cu ON cu.client_user_id = bm.client_user_id
        WHERE bm.client_id = ? AND cu.archived_at IS NULL
        ORDER BY FIELD(bm.role,'owner','rep','viewer'), cu.display_name ASC`,
      [clientId]
    );
    return rows.map((r) => ({
      clientUserId: Number(r.client_user_id),
      email: r.email,
      displayName: r.display_name,
      role: isRole(r.role) ? r.role : 'rep'
    }));
  } catch (err) {
    console.error('[membership:listBrandMembers]', (err as Error).message);
    return [];
  }
}
