/**
 * Typed access to shhdbite_AV.client_users.
 *
 * All reads filter `archived_at IS NULL`. All writes touch only the
 * columns they need to touch.
 */
import type { RowDataPacket } from 'mysql2';
import { getAvDb } from '@/lib/db/av';

export type ClientUserTier = 'audit_only' | 'sprint' | 'momentum' | 'scale';

export interface ClientUserRow extends RowDataPacket {
  client_user_id: number;
  client_id: number | null;
  email: string;
  display_name: string | null;
  password_hash: string | null;
  magic_token: string | null;
  magic_token_expires_at: Date | null;
  email_verified_at: Date | null;
  last_login_at: Date | null;
  tier: ClientUserTier;
  created_at: Date;
  updated_at: Date;
}

export async function findClientUserByEmail(email: string): Promise<ClientUserRow | null> {
  const db = getAvDb();
  const [rows] = await db.execute<ClientUserRow[]>(
    `SELECT client_user_id, client_id, email, display_name, password_hash,
            magic_token, magic_token_expires_at, email_verified_at,
            last_login_at, tier, created_at, updated_at
       FROM client_users
      WHERE email = ? AND archived_at IS NULL
      LIMIT 1`,
    [email]
  );
  return rows[0] ?? null;
}

export async function findClientUserById(id: number): Promise<ClientUserRow | null> {
  const db = getAvDb();
  const [rows] = await db.execute<ClientUserRow[]>(
    `SELECT client_user_id, client_id, email, display_name, password_hash,
            magic_token, magic_token_expires_at, email_verified_at,
            last_login_at, tier, created_at, updated_at
       FROM client_users
      WHERE client_user_id = ? AND archived_at IS NULL
      LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function findClientUserByMagicToken(token: string): Promise<ClientUserRow | null> {
  if (!token || token.length !== 64) return null;
  const db = getAvDb();
  const [rows] = await db.execute<ClientUserRow[]>(
    `SELECT client_user_id, client_id, email, display_name, password_hash,
            magic_token, magic_token_expires_at, email_verified_at,
            last_login_at, tier, created_at, updated_at
       FROM client_users
      WHERE magic_token = ?
        AND magic_token_expires_at IS NOT NULL
        AND magic_token_expires_at > NOW()
        AND archived_at IS NULL
      LIMIT 1`,
    [token]
  );
  return rows[0] ?? null;
}

/**
 * Upsert by email: if a row exists, reset its magic token and bump the
 * tier upward (never downgrade). If no row exists, create one in tier
 * 'audit_only' with a fresh magic token.
 *
 * Returns the resulting row plus a flag indicating whether the row was
 * newly created.
 */
export async function upsertClientUserForIntake(params: {
  email: string;
  displayName: string | null;
  magicToken: string;
  magicTokenExpiresAt: Date;
  intakePayload: unknown;
}): Promise<{ row: ClientUserRow; created: boolean }> {
  const db = getAvDb();
  const existing = await findClientUserByEmail(params.email);
  if (existing) {
    await db.execute(
      `UPDATE client_users
          SET magic_token = ?,
              magic_token_expires_at = ?,
              display_name = COALESCE(display_name, ?),
              intake_payload = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE client_user_id = ?`,
      [
        params.magicToken,
        params.magicTokenExpiresAt,
        params.displayName,
        JSON.stringify(params.intakePayload ?? null),
        existing.client_user_id
      ]
    );
    const refreshed = await findClientUserById(existing.client_user_id);
    return { row: refreshed!, created: false };
  }

  await db.execute(
    `INSERT INTO client_users
       (email, display_name, magic_token, magic_token_expires_at,
        tier, intake_payload)
     VALUES (?, ?, ?, ?, 'audit_only', ?)`,
    [
      params.email,
      params.displayName,
      params.magicToken,
      params.magicTokenExpiresAt,
      JSON.stringify(params.intakePayload ?? null)
    ]
  );
  const created = await findClientUserByEmail(params.email);
  if (!created) {
    throw new Error('client_users insert returned no row');
  }
  return { row: created, created: true };
}

/** Clear the magic token and mark email verified. Idempotent. */
export async function consumeMagicToken(clientUserId: number): Promise<void> {
  const db = getAvDb();
  await db.execute(
    `UPDATE client_users
        SET magic_token = NULL,
            magic_token_expires_at = NULL,
            email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
      WHERE client_user_id = ?`,
    [clientUserId]
  );
}

export async function setClientUserPasswordHash(
  clientUserId: number,
  passwordHash: string
): Promise<void> {
  const db = getAvDb();
  await db.execute(
    `UPDATE client_users
        SET password_hash = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE client_user_id = ?`,
    [passwordHash, clientUserId]
  );
}

export async function markClientUserLoggedIn(clientUserId: number): Promise<void> {
  const db = getAvDb();
  await db.execute(
    `UPDATE client_users
        SET last_login_at = CURRENT_TIMESTAMP
      WHERE client_user_id = ?`,
    [clientUserId]
  );
}
