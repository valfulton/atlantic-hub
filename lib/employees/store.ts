/**
 * lib/employees/store.ts
 *
 * Employee / sales-rep data access. An "employee" is an admin_users row with
 * role='staff', plus an employee_profiles row (onboarding) and employee_documents.
 *
 * Staff accounts have no native self-serve set-password flow (password_hash is
 * NOT NULL and there's no staff magic link), so create-employee seeds an unusable
 * placeholder password + a set_password_token; the employee sets their real
 * password via the invite link (schema 053), then logs in normally at /login.
 *
 * TWO DATABASES (this is load-bearing — read before editing a query here):
 *   - admin_users lives in the PLATFORM db (getPlatformDb / shhdbite_atlantic_hub).
 *     That is the table /login authenticates against, and its role ENUM includes
 *     'staff'. The employee's *account* row MUST go here, or they can't log in.
 *     (schema/053_platform_employee_invite.sql adds set_password_token there.)
 *   - employee_profiles + employee_documents live in the AV db (getAvDb /
 *     shhdbite_AV), keyed by the platform admin_users.user_id — the same
 *     cross-DB, app-enforced pattern as leads.assigned_to_user_id. We therefore
 *     never SQL-join the two; we query each pool and merge in JS.
 */
import { getAvDb } from '@/lib/db/av';
import { getPlatformDb } from '@/lib/db/platform';
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
  contract_signed_name: string | null;
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
  const db = getPlatformDb(); // admin_users (the table /login uses) lives here
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
  const db = getPlatformDb();
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
  const hash = await hashPassword(plaintext);
  // admin_users in the platform db; profile status in the AV db.
  await getPlatformDb().execute(
    `UPDATE admin_users
        SET password_hash = ?, set_password_token = NULL, set_password_expires_at = NULL
      WHERE user_id = ?`,
    [hash, userId]
  );
  await getAvDb().execute(
    `UPDATE employee_profiles SET status = IF(status = 'invited', 'active', status) WHERE user_id = ?`,
    [userId]
  );
}

interface ProfileRow extends RowDataPacket {
  user_id: number;
  title: string | null;
  status: string | null;
  application_completed_at: Date | null;
  contract_signed_at: Date | null;
  contract_signed_name: string | null;
}

/** Fetch employee_profiles rows (AV db) for a set of user ids, keyed by user_id. */
async function profilesByUserId(userIds: number[]): Promise<Map<number, ProfileRow>> {
  const map = new Map<number, ProfileRow>();
  if (userIds.length === 0) return map;
  const placeholders = userIds.map(() => '?').join(', ');
  const [rows] = await getAvDb().execute<ProfileRow[]>(
    `SELECT user_id, title, status, application_completed_at, contract_signed_at, contract_signed_name
       FROM employee_profiles WHERE user_id IN (${placeholders})`,
    userIds
  );
  for (const r of rows) map.set(Number(r.user_id), r);
  return map;
}

/** List staff employees (excludes owner + client_user) with profile basics. */
export async function listEmployees(): Promise<EmployeeRow[]> {
  // admin_users (platform db) is the source of truth for the account.
  const [users] = await getPlatformDb().execute<(RowDataPacket & {
    user_id: number; email: string; display_name: string;
    role: 'owner' | 'staff' | 'client_user'; is_active: number; created_at: Date;
  })[]>(
    `SELECT user_id, email, display_name, role, is_active, created_at
       FROM admin_users WHERE role = 'staff' ORDER BY created_at DESC`
  );
  const profiles = await profilesByUserId(users.map((u) => Number(u.user_id)));
  return users.map((u) => {
    const p = profiles.get(Number(u.user_id));
    return {
      user_id: u.user_id,
      email: u.email,
      display_name: u.display_name,
      role: u.role,
      is_active: u.is_active,
      created_at: u.created_at,
      title: p?.title ?? null,
      status: p?.status ?? null,
      application_completed_at: p?.application_completed_at ?? null,
      contract_signed_at: p?.contract_signed_at ?? null,
      contract_signed_name: p?.contract_signed_name ?? null
    } as EmployeeRow;
  });
}

/** One staff employee (with profile), or null. */
export async function getEmployee(userId: number): Promise<EmployeeRow | null> {
  if (!userId || userId <= 0) return null;
  const [users] = await getPlatformDb().execute<(RowDataPacket & {
    user_id: number; email: string; display_name: string;
    role: 'owner' | 'staff' | 'client_user'; is_active: number; created_at: Date;
  })[]>(
    `SELECT user_id, email, display_name, role, is_active, created_at
       FROM admin_users WHERE user_id = ? AND role = 'staff' LIMIT 1`,
    [userId]
  );
  const u = users[0];
  if (!u) return null;
  const p = (await profilesByUserId([Number(u.user_id)])).get(Number(u.user_id));
  return {
    user_id: u.user_id,
    email: u.email,
    display_name: u.display_name,
    role: u.role,
    is_active: u.is_active,
    created_at: u.created_at,
    title: p?.title ?? null,
    status: p?.status ?? null,
    application_completed_at: p?.application_completed_at ?? null,
    contract_signed_at: p?.contract_signed_at ?? null,
    contract_signed_name: p?.contract_signed_name ?? null
  } as EmployeeRow;
}

export interface EmployeeApplication {
  title: string | null;
  phone: string | null;
  location: string | null;
  startDate: string | null;
  compBasis: string | null;
  emergencyContact: string | null;
  payload: Record<string, unknown>;
  completedAt: string | null;
  status: string | null;
}

/** Read an employee's application (structured fields + freeform payload). */
export async function getEmployeeApplication(userId: number): Promise<EmployeeApplication | null> {
  if (!userId || userId <= 0) return null;
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & {
    title: string | null; phone: string | null; location: string | null;
    start_date: Date | null; comp_basis: string | null; emergency_contact: string | null;
    application_payload: unknown; application_completed_at: Date | null; status: string | null;
  })[]>(
    `SELECT title, phone, location, start_date, comp_basis, emergency_contact,
            application_payload, application_completed_at, status
       FROM employee_profiles WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  const r = rows[0];
  if (!r) return null;
  let payload: Record<string, unknown> = {};
  try {
    const raw = r.application_payload;
    payload = typeof raw === 'string' ? JSON.parse(raw) : ((raw as Record<string, unknown>) ?? {});
  } catch { payload = {}; }
  return {
    title: r.title,
    phone: r.phone,
    location: r.location,
    startDate: r.start_date ? new Date(r.start_date).toISOString().slice(0, 10) : null,
    compBasis: r.comp_basis,
    emergencyContact: r.emergency_contact,
    payload,
    completedAt: r.application_completed_at ? new Date(r.application_completed_at).toISOString() : null,
    status: r.status
  };
}

/** Save an employee's application; stamps completion + advances status to 'applied'. */
export async function saveEmployeeApplication(userId: number, fields: {
  title?: string | null;
  phone?: string | null;
  location?: string | null;
  startDate?: string | null;
  compBasis?: string | null;
  emergencyContact?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const db = getAvDb();
  await db.execute(
    `INSERT INTO employee_profiles (user_id, status) VALUES (?, 'applied')
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [userId]
  );
  await db.execute(
    `UPDATE employee_profiles
        SET title = ?, phone = ?, location = ?, start_date = ?, comp_basis = ?, emergency_contact = ?,
            application_payload = ?, application_completed_at = NOW(),
            status = IF(status IN ('invited','applied'), 'applied', status)
      WHERE user_id = ?`,
    [
      fields.title ?? null,
      fields.phone ?? null,
      fields.location ?? null,
      fields.startDate || null,
      fields.compBasis ?? null,
      fields.emergencyContact ?? null,
      JSON.stringify(fields.payload ?? {}),
      userId
    ]
  );
}

export interface EmployeeDocument extends RowDataPacket {
  doc_id: number;
  user_id: number;
  label: string;
  file_url: string;       // internal blob key (served via the documents route)
  content_type: string | null;
  created_at: Date;
}

/** Record an uploaded document (the bytes live in hot storage under blobKey). */
export async function addEmployeeDocument(params: {
  userId: number; label: string; blobKey: string; contentType: string | null; uploadedBy: number | null;
}): Promise<number> {
  const db = getAvDb();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO employee_documents (user_id, label, file_url, content_type, uploaded_by)
     VALUES (?, ?, ?, ?, ?)`,
    [params.userId, params.label.slice(0, 200), params.blobKey, params.contentType, params.uploadedBy]
  );
  return res.insertId;
}

export async function listEmployeeDocuments(userId: number): Promise<EmployeeDocument[]> {
  const db = getAvDb();
  const [rows] = await db.execute<EmployeeDocument[]>(
    `SELECT doc_id, user_id, label, file_url, content_type, created_at
       FROM employee_documents WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

export async function getEmployeeDocument(docId: number): Promise<EmployeeDocument | null> {
  const db = getAvDb();
  const [rows] = await db.execute<EmployeeDocument[]>(
    `SELECT doc_id, user_id, label, file_url, content_type, created_at
       FROM employee_documents WHERE doc_id = ? LIMIT 1`,
    [docId]
  );
  return rows[0] ?? null;
}

export async function deleteEmployeeDocument(docId: number): Promise<void> {
  const db = getAvDb();
  await db.execute(`DELETE FROM employee_documents WHERE doc_id = ?`, [docId]);
}

/** Record a signed contract (typed name + timestamp; optional stored contract doc). */
export async function signEmployeeContract(userId: number, signedName: string, contractDocUrl?: string | null): Promise<void> {
  const db = getAvDb();
  await db.execute(
    `INSERT INTO employee_profiles (user_id, status) VALUES (?, 'active')
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [userId]
  );
  await db.execute(
    `UPDATE employee_profiles
        SET contract_signed_name = ?, contract_signed_at = NOW(),
            contract_doc_url = COALESCE(?, contract_doc_url),
            status = IF(status IN ('invited','applied'), 'active', status)
      WHERE user_id = ?`,
    [signedName.slice(0, 160), contractDocUrl ?? null, userId]
  );
}
