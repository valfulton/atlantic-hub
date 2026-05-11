/**
 * Owner bootstrap.
 *
 * On first DB call after deploy, ensures the admin_users table contains
 * the real owner row defined by OWNER_BOOTSTRAP_EMAIL +
 * OWNER_BOOTSTRAP_PASSWORD_HASH env vars.
 *
 * Idempotent: safe to call on every cold start. Caches success for the
 * lifetime of the Lambda instance.
 */
import { getPlatformDb } from '@/lib/db/platform';
import type { RowDataPacket } from 'mysql2';

let bootstrapped = false;

export async function ensureOwnerBootstrap(): Promise<void> {
  if (bootstrapped) return;

  const email = process.env.OWNER_BOOTSTRAP_EMAIL;
  const passwordHash = process.env.OWNER_BOOTSTRAP_PASSWORD_HASH;
  if (!email || !passwordHash) {
    // Misconfigured deploy; do not silently succeed.
    throw new Error('OWNER_BOOTSTRAP_EMAIL and OWNER_BOOTSTRAP_PASSWORD_HASH must be set');
  }

  const db = getPlatformDb();
  // Insert if missing; update password_hash if the env var has been rotated.
  // We do NOT update `display_name` after first creation to avoid clobbering
  // an admin-edited name later.
  await db.execute(
    `INSERT INTO admin_users (email, password_hash, role, is_active, display_name)
     VALUES (?, ?, 'owner', TRUE, 'Owner')
     ON DUPLICATE KEY UPDATE
       password_hash = VALUES(password_hash),
       role = 'owner',
       is_active = TRUE`,
    [email, passwordHash]
  );

  // Also disable the placeholder bootstrap row from 003_seed.sql.
  await db.execute(
    `UPDATE admin_users SET is_active = FALSE
     WHERE email = 'bootstrap-placeholder@atlantic-hub.local'`
  );

  bootstrapped = true;
}

export interface AdminUserRow extends RowDataPacket {
  user_id: number;
  email: string;
  password_hash: string;
  role: 'owner' | 'staff' | 'client_user';
  is_active: 0 | 1;
  display_name: string;
}
