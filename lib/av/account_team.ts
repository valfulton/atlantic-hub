/**
 * lib/av/account_team.ts  (Spinoff B — "Invite co-pilot" / joint tenants)
 *
 * Co-pilot logins = two (or more) people who log in with SEPARATE emails but
 * see the SAME client brand. Test case: Kevin Lyons + Maile Lyons both on The
 * Flame (client_id 16). The data model already supports this with no schema
 * change: `client_users.email` is UNIQUE but `client_users.client_id` is NOT
 * (see schema/009_client_portal.sql — "One client can in principle have
 * multiple logins"). So a co-pilot is simply another `client_users` row bound
 * directly to the same `client_id`. There is deliberately NO separate
 * "co-pilot role" — co-pilots are full client_users with full access. The
 * joint nature is brand-level (they share a brand), not permission-level.
 *
 * This lib is the operator-side primitive behind:
 *   - the "Invite co-pilot" button on /admin/av/clients/[id]
 *   - the API route /api/admin/av/clients/[client_id]/copilots/invite
 *
 * It mirrors the existing `attach-login` create path (lib reuse of the same
 * primitives) but bundles the magic-link token onto the freshly-minted row so
 * the operator gets one shareable sign-in link back per invite — rather than
 * the generic /magic-link route which resolves `WHERE client_id = ? LIMIT 1`
 * and would always target the FIRST login (ambiguous once co-pilots exist).
 */
import { getAvDb } from '@/lib/db/av';
import { getPlatformDb } from '@/lib/db/platform';
import { findClientUserByEmail } from '@/lib/auth/client-user';
import {
  generateMagicToken,
  magicTokenExpiresAt,
  buildMagicLinkUrl,
  MAGIC_TOKEN_TTL_HOURS
} from '@/lib/auth/client-magic-token';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface CopilotLogin {
  clientUserId: number;
  email: string;
  displayName: string | null;
  tier: string;
  lastLoginAt: string | null;
  emailVerifiedAt: string | null;
  hasPassword: boolean;
  createdAt: string | null;
}

interface CopilotRow extends RowDataPacket {
  client_user_id: number;
  email: string;
  display_name: string | null;
  tier: string;
  last_login_at: Date | string | null;
  email_verified_at: Date | string | null;
  password_hash: string | null;
  created_at: Date | string | null;
}

function toIso(v: Date | string | null): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Every login bound directly to this brand (i.e. every co-pilot). Ordered by
 * creation so the original owner sits first, co-pilots after. Soft-fails to []
 * so the operator UI never breaks on a DB miss.
 */
export async function listCopilots(clientId: number): Promise<CopilotLogin[]> {
  if (!Number.isInteger(clientId) || clientId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<CopilotRow[]>(
      `SELECT client_user_id, email, display_name, tier, last_login_at,
              email_verified_at, password_hash, created_at
         FROM client_users
        WHERE client_id = ? AND archived_at IS NULL
        ORDER BY created_at ASC, client_user_id ASC`,
      [clientId]
    );
    return rows.map((r) => ({
      clientUserId: Number(r.client_user_id),
      email: r.email,
      displayName: r.display_name,
      tier: r.tier,
      lastLoginAt: toIso(r.last_login_at),
      emailVerifiedAt: toIso(r.email_verified_at),
      hasPassword: !!r.password_hash,
      createdAt: toIso(r.created_at)
    }));
  } catch {
    return [];
  }
}

/**
 * How many active logins share this brand. >= 2 means the brand is jointly
 * held — the signal the approval UI uses to show the "joint authority" badge
 * (either co-pilot's approval counts; both are notified).
 */
export async function countActiveClientLogins(clientId: number): Promise<number> {
  if (!Number.isInteger(clientId) || clientId <= 0) return 0;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { n: number })[]>(
      `SELECT COUNT(*) AS n FROM client_users
        WHERE client_id = ? AND archived_at IS NULL`,
      [clientId]
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

export interface InviteCopilotResult {
  ok: boolean;
  /** 'created' = minted a new login; 'reissued' = existing co-pilot got a fresh link. */
  mode?: 'created' | 'reissued';
  clientUserId?: number;
  email?: string;
  displayName?: string | null;
  /** The shareable one-time sign-in link for THIS co-pilot. */
  magicLink?: string;
  expiresInHours?: number;
  /** Machine-readable error code + a human reason for the operator UI. */
  error?: string;
  reason?: string;
  /** Set on an email-collision-with-another-brand so the UI can point at attach-login. */
  existingClientUserId?: number;
  existingClientId?: number | null;
}

/**
 * Invite a co-pilot to a brand: mint a second `client_users` row bound to the
 * same `client_id`, stamp a fresh magic-link token on it, and return the
 * shareable sign-in link. Full access — no role downgrade, no separate concept.
 *
 * Collision handling (email is globally UNIQUE on client_users):
 *   - email already on THIS brand → idempotent: re-issue a fresh magic link to
 *     the existing co-pilot (mode='reissued'). This makes the button safe to
 *     re-click and doubles as "resend their link".
 *   - email on a DIFFERENT brand → conflict: that person is an existing login
 *     elsewhere. We don't silently move them; the operator should use the
 *     "Attach existing" flow (brand_members) if cross-brand sharing is intended.
 */
export async function inviteCopilot(
  clientId: number,
  email: string,
  displayName?: string | null
): Promise<InviteCopilotResult> {
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return { ok: false, error: 'bad_client_id', reason: 'Invalid client id.' };
  }
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail)) {
    return { ok: false, error: 'bad_email', reason: 'A valid email is required.' };
  }
  const cleanName =
    typeof displayName === 'string' && displayName.trim().length > 0
      ? displayName.trim().slice(0, 200)
      : null;

  try {
    const db = getAvDb();

    // Verify the brand exists + isn't archived before binding anyone to it.
    const [clientRows] = await db.execute<(RowDataPacket & { client_id: number })[]>(
      `SELECT client_id FROM clients WHERE client_id = ? AND archived_at IS NULL LIMIT 1`,
      [clientId]
    );
    if (clientRows.length === 0) {
      return { ok: false, error: 'no_client', reason: 'That brand does not exist or is archived.' };
    }

    const token = generateMagicToken();
    const expiresAt = magicTokenExpiresAt();

    // Collision check — email is UNIQUE across all client_users.
    const existing = await findClientUserByEmail(cleanEmail);
    if (existing) {
      if (existing.client_id === clientId) {
        // Already a co-pilot on this brand — reissue a fresh link instead of
        // erroring. Safe to re-click; also serves as "resend".
        await db.execute<ResultSetHeader>(
          `UPDATE client_users
              SET magic_token = ?, magic_token_expires_at = ?,
                  display_name = COALESCE(display_name, ?),
                  updated_at = CURRENT_TIMESTAMP
            WHERE client_user_id = ?`,
          [token, expiresAt, cleanName, existing.client_user_id]
        );
        return {
          ok: true,
          mode: 'reissued',
          clientUserId: existing.client_user_id,
          email: existing.email,
          displayName: existing.display_name ?? cleanName,
          magicLink: buildMagicLinkUrl(token),
          expiresInHours: MAGIC_TOKEN_TTL_HOURS
        };
      }
      // Exists on a different brand (or unbound) — don't hijack the row.
      return {
        ok: false,
        error: 'email_on_other_brand',
        reason: `A login already exists for ${cleanEmail} on another brand (id ${existing.client_user_id}). To let the same person co-pilot multiple brands, use "Attach existing" instead — that shares them via brand_members without minting a duplicate.`,
        existingClientUserId: existing.client_user_id,
        existingClientId: existing.client_id
      };
    }

    // Fresh co-pilot — bind directly to this brand, with the magic token set so
    // the operator gets a shareable link back in one round-trip.
    const [insertRes] = await db.execute<ResultSetHeader>(
      `INSERT INTO client_users
         (email, display_name, tier, client_id, magic_token, magic_token_expires_at)
       VALUES (?, ?, 'audit_only', ?, ?, ?)`,
      [cleanEmail, cleanName, clientId, token, expiresAt]
    );

    return {
      ok: true,
      mode: 'created',
      clientUserId: insertRes.insertId,
      email: cleanEmail,
      displayName: cleanName,
      magicLink: buildMagicLinkUrl(token),
      expiresInHours: MAGIC_TOKEN_TTL_HOURS
    };
  } catch (e) {
    return { ok: false, error: 'server_error', reason: (e as Error).message };
  }
}

export interface ResolvedApprover {
  /** Display name for the badge, e.g. "Kevin Lyons" or "Kevin". */
  name: string;
  /** Which identity space the id resolved in. */
  kind: 'client_user' | 'operator';
}

/**
 * Resolve who approved a draft, for the "approved by X" badge. The
 * `cockpit_approvals.approved_by_user_id` column is written by whichever surface
 * stamped the approval, so the id can live in EITHER identity space:
 *   - a co-pilot approving from the client side → client_users.client_user_id
 *   - the operator (val) green-lighting → admin_users.user_id (platform DB)
 * We check client_users first (the joint-tenant case this feature is about),
 * then fall back to the platform admin_users table. Soft-fails to null.
 */
export async function resolveApproverDisplayName(
  userId: number | null | undefined
): Promise<ResolvedApprover | null> {
  if (!userId || !Number.isInteger(userId) || userId <= 0) return null;
  try {
    const av = getAvDb();
    const [cu] = await av.execute<(RowDataPacket & { display_name: string | null; email: string })[]>(
      `SELECT display_name, email FROM client_users WHERE client_user_id = ? LIMIT 1`,
      [userId]
    );
    if (cu[0]) {
      return { name: cu[0].display_name?.trim() || cu[0].email.split('@')[0], kind: 'client_user' };
    }
  } catch {
    /* fall through to operator lookup */
  }
  try {
    const platform = getPlatformDb();
    const [au] = await platform.execute<(RowDataPacket & { display_name: string | null; email: string })[]>(
      `SELECT display_name, email FROM admin_users WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    if (au[0]) {
      return { name: au[0].display_name?.trim() || au[0].email.split('@')[0], kind: 'operator' };
    }
  } catch {
    /* ignore */
  }
  return null;
}
