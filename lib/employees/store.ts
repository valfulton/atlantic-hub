/**
 * lib/employees/store.ts
 *
 * Employee / sales-rep data access. An "employee" is an admin_users row with
 * role='staff', plus an employee_profiles row (onboarding) and employee_documents.
 *
 * Staff accounts have no native self-serve set-password flow (password_hash is
 * NOT NULL and there's no staff magic link), so create-employee seeds an unusable
 * placeholder password + a set_password_token; the employee sets their real
 * password via the invite link (schema 052), then logs in normally at /login.
 */
import { getAvDb } from '@/lib/db/av';
import { generateMagicToken } from '@/lib/auth/client-magic-token';
import { hashPassword } from '@/lib/auth/password';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const TOKEN_TTL_DAYS = 14;

export interface EmployeeRow extends RowDataPacket {
  user_id: number;
  email: string;
  display_name: string;
  role: 'owner' | 'staff' | 'client_user';
  is_active: number;
  created_at: Date;
  title: string | null;
  status: string | null;
  application_completed_at: Date | null;
  contract_signed_at: Date | null;
}

export interface CreateEmployeeResult {
  userId: number;
  token: string;
  created: boolean;
}

/** Create (or re-invite) a staff employee + profile; issue a set-password token. */
export async function createEmployee(params: {
  email: string;
  displayName: string;
  title?: string | null;
}): Promise<CreateEmployeeResult> {
  const db = getAvDb();
  const email = params.email.toLowerCase().trim();
  const displayName = params.displayName.trim() || email.split('@')[0];
  const token = generateMagicToken();
  const expires = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  // Unusable placeholder (password_hash is NOT NULL); replaced on set-password.
  const placeholder = await hashPassword(generateMagicToken());

  const [existing] = await db.execute<(RowDataPacket & { user_id: number; role: string })[]>(
    `SELECT user_id, role FROM admin_users WHERE email = ? LIMIT 1`,
    [email]
  );

  if (existing.length > 0) {
    const userId = existing[0].user_id;
    // Re-issue invite; never downgrade an existing owner's role.
    await db.execute(
      `UPDATE admin_users
          SET set_password_token = ?, set_password_expires_at = ?, is_active = 1,
              display_name = COALESCE(NULLIF(display_name, ''), ?)
        WHERE user_id = ?`,
      [token, expires, displayName, userId]
    );
    await ensureProfile(userId, params.title ?? null);
    return { userId, token, created: false };
  }

  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO admin_users
       (email, password_hash, role, is_active, display_name, set_password_token, set_password_expires_at)
     VALUES (?, ?, 'staff', 1, ?, ?, ?)`,
    [email, placeholder, displayName, token, expires]
  );
  const userId = res.insertId;
  await ensureProfile(userId, params.title ?? null);
  return { userId, token, created: true };
}

async function ensureProfile(userId: number, title: string | null): Promise<void> {
  const db = getAvDb();
  await db.execute(
    `INSERT INTO employee_profiles (user_id, status, title)
       VALUES (?, 'invited', ?)
     ON DUPLICATE KEY UPDATE title = COALESCE(VALUES(title), title)`,
    [userId, title]
  );
}

/** Verify a set-password invite token → the user_id, or null if invalid/expired. */
export async function userIdForSetPasswordToken(token: string): Promise<number | null> {
  if (!token || token.length !== 64 || !/^[a-f0-9]{64}$/i.test(token)) return null;
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { user_id: number })[]>(
    `SELECT user_id FROM admin_users
      WHERE set_password_token = ?
        AND set_password_expires_at IS NOT NULL
        AND set_password_expires_at > NOW()
        AND is_active = 1
      LIMIT 1`,
    [token]
  );
  return rows[0]?.user_id ?? null;
}

/** Set an employee's password, clear the invite token, mark profile active. */
export async function setEmployeePassword(userId: number, plaintext: string): Promise<void> {
  const db = getAvDb();
  const hash = await hashPassword(plaintext);
  await db.execute(
    `UPDATE admin_users
        SET password_hash = ?, set_password_token = NULL, set_password_expires_at = NULL
      WHERE user_id = ?`,
    [hash, userId]
  );
  await db.execute(
    `UPDATE employee_profiles SET status = IF(status = 'invited', 'active', status) WHERE user_id = ?`,
    [userId]
  );
}

/** List staff employees (excludes owner + client_user) with profile basics. */
export async function listEmployees(): Promise<EmployeeRow[]> {
  const db = getAvDb();
  const [rows] = await db.execute<EmployeeRow[]>(
    `SELECT u.user_id, u.email, u.display_name, u.role, u.is_active, u.created_at,
            p.title, p.status, p.application_completed_at, p.contract_signed_at
       FROM admin_users u
       LEFT JOIN employee_profiles p ON p.user_id = u.user_id
      WHERE u.role = 'staff'
      ORDER BY u.created_at DESC`
  );
  return rows;
}

/** One staff employee (with profile), or null. */
export async function getEmployee(userId: number): Promise<EmployeeRow | null> {
  if (!userId || userId <= 0) return null;
  const db = getAvDb();
  const [rows] = await db.execute<EmployeeRow[]>(
    `SELECT u.user_id, u.email, u.display_name, u.role, u.is_active, u.created_at,
            p.title, p.status, p.application_completed_at, p.contract_signed_at
       FROM admin_users u
       LEFT JOIN employee_profiles p ON p.user_id = u.user_id
      WHERE u.user_id = ? AND u.role = 'staff'
      LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}
