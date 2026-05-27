/**
 * lib/client/provision.ts
 *
 * Auto-provisioning for the per-account client hub.
 *
 * A paying client runs their OWN hub and builds everything from scratch
 * (they do NOT inherit Val's leads). For any of that to be ownable, the
 * client_user must point at a `clients` row via client_users.client_id.
 * Intake (upsertClientUserForIntake) leaves client_id NULL, so we provision
 * lazily: the first time an authenticated client lands, ensureClientHub()
 * creates their clients row and links it. Idempotent + non-fatal by design
 * (a provisioning hiccup must never block login).
 *
 * This is the foundational unblock for the client-hub-parity work: every
 * scoped read/write keys off client_id, and NULL means "no hub yet".
 */
import { randomUUID } from 'crypto';
import { getAvDb } from '@/lib/db/av';
import type { ClientUserRow } from '@/lib/auth/client-user';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

/** clients.plan_tier is a coarse internal flag (no 'audit_only'); map down. */
function planTierFor(tier: ClientUserRow['tier']): 'sprint' | 'momentum' | 'scale' {
  return tier === 'momentum' || tier === 'scale' ? tier : 'sprint';
}

function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return s || 'client';
}

type ProvisionUser = Pick<ClientUserRow, 'client_user_id' | 'client_id' | 'display_name' | 'email' | 'tier'>;

export type PlanTier = 'sprint' | 'momentum' | 'scale';

async function insertClient(
  name: string,
  slug: string,
  planTier: PlanTier
): Promise<number> {
  const db = getAvDb();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO clients (client_uuid, client_name, client_slug, plan_tier)
     VALUES (?, ?, ?, ?)`,
    [randomUUID(), name.slice(0, 255), slug, planTier]
  );
  return res.insertId;
}

/** Pick a slug derived from name that doesn't collide (client_slug is UNIQUE). */
async function pickFreeSlug(baseName: string): Promise<string> {
  const baseSlug = slugify(baseName);
  try {
    const db = getAvDb();
    const [taken] = await db.execute<RowDataPacket[]>(
      `SELECT client_slug FROM clients WHERE client_slug LIKE ?`,
      [`${baseSlug}%`]
    );
    const used = new Set(taken.map((r) => String(r.client_slug)));
    return used.has(baseSlug) ? `${baseSlug}-${randomUUID().slice(0, 6)}` : baseSlug;
  } catch {
    return `${baseSlug}-${randomUUID().slice(0, 6)}`;
  }
}

/**
 * Create a standalone brand hub (a `clients` row) and return its client_id —
 * WITHOUT touching client_users. This is the multi-brand primitive: a brand can
 * be owned by an existing login (via brand_members) rather than minting a new
 * login. Returns null on failure. See lib/av/add_brand.ts.
 */
export async function createBrandHub(name: string, planTier: PlanTier = 'sprint'): Promise<number | null> {
  const cleanName = (name && name.trim()) || 'Brand';
  try {
    return await insertClient(cleanName, await pickFreeSlug(cleanName), planTier);
  } catch {
    try {
      return await insertClient(cleanName, `${slugify(cleanName)}-${randomUUID().slice(0, 6)}`, planTier);
    } catch (err) {
      console.error('[client-provision] createBrandHub failed:', (err as Error).message);
      return null;
    }
  }
}

export { planTierFor };

/**
 * Ensure the given client_user has its own clients row + linked client_id.
 * Returns the effective client_id (existing or freshly created), or null on
 * failure. Safe to call on every authenticated landing — it early-returns
 * when already provisioned.
 */
export async function ensureClientHub(user: ProvisionUser): Promise<number | null> {
  const existing = Number(user.client_id);
  if (Number.isInteger(existing) && existing > 0) return existing;

  const db = getAvDb();
  const baseName = (user.display_name && user.display_name.trim()) || user.email.split('@')[0] || 'Client';
  const baseSlug = slugify(baseName);
  const planTier = planTierFor(user.tier);

  // Pick a slug that doesn't collide (slug is UNIQUE on clients).
  let slug = baseSlug;
  try {
    const [taken] = await db.execute<RowDataPacket[]>(
      `SELECT client_slug FROM clients WHERE client_slug LIKE ?`,
      [`${baseSlug}%`]
    );
    const used = new Set(taken.map((r) => String(r.client_slug)));
    if (used.has(slug)) slug = `${baseSlug}-${randomUUID().slice(0, 6)}`;
  } catch {
    slug = `${baseSlug}-${randomUUID().slice(0, 6)}`;
  }

  let clientId: number;
  try {
    clientId = await insertClient(baseName, slug, planTier);
  } catch {
    // Slug/uuid race or collision — retry once with a random suffix.
    try {
      clientId = await insertClient(baseName, `${baseSlug}-${randomUUID().slice(0, 6)}`, planTier);
    } catch (err) {
      console.error('[client-provision] insert failed:', (err as Error).message);
      return null;
    }
  }

  // Link only if still unlinked (guards a concurrent login that already won).
  try {
    await db.execute(
      `UPDATE client_users
          SET client_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE client_user_id = ? AND client_id IS NULL`,
      [clientId, user.client_user_id]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT client_id FROM client_users WHERE client_user_id = ? LIMIT 1`,
      [user.client_user_id]
    );
    const linked = rows[0]?.client_id ? Number(rows[0].client_id) : clientId;
    return linked;
  } catch (err) {
    console.error('[client-provision] link failed:', (err as Error).message);
    return clientId;
  }
}
