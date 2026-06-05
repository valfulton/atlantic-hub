/**
 * lib/av/account_employees.ts  (#377)
 *
 * Operator-side CRUD for AV-employee → client-account assignments. Paired with
 * `lib/client/employees_on_account.ts` (the read path used by the client
 * dashboard) and the schema in `074_account_employees.sql`.
 *
 * The relationship: an `admin_users` employee (platform DB) is bound to a
 * `clients` row (AV DB) with a role. There's one `primary_rep` per brand
 * (enforced in code — UNIQUE KEY in the table is on (client_id, user_id) so the
 * same person can't double-assign; this lib ensures uniqueness of `primary_rep`
 * by demoting whoever currently holds the slot).
 *
 * Two databases (same pattern as `lib/employees/store.ts`):
 *   - admin_users + employee_profiles + account_employees on AV / platform
 *   - we never SQL-join the two; we query each pool and merge in JS.
 */
import { getAvDb } from '@/lib/db/av';
import { getPlatformDb } from '@/lib/db/platform';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export type AccountEmployeeRole = 'primary_rep' | 'rep' | 'support';

export interface AccountEmployeeAssignment {
  userId: number;              // platform admin_users.user_id
  displayName: string;
  email: string | null;
  title: string | null;        // AV employee_profiles.title
  role: AccountEmployeeRole;
  assignedAt: string;          // ISO
}

/** Active staff employees (admin_users.role = 'staff', is_active = 1), with
 *  their AV-side title. Used by the operator UI to populate the "assign"
 *  dropdown. Excludes users already assigned to this client when `excludeClientId`
 *  is provided — they're already on the team. */
export interface AssignableEmployee {
  userId: number;
  displayName: string;
  email: string;
  title: string | null;
}

interface AdminRow extends RowDataPacket {
  user_id: number;
  email: string;
  display_name: string | null;
}
interface AssignmentRow extends RowDataPacket {
  user_id: number;
  role: AccountEmployeeRole;
  assigned_at: Date | string;
}
interface ProfileRow extends RowDataPacket {
  user_id: number;
  title: string | null;
}

/** List active staff employees the operator can assign. Optionally excludes
 *  the ones already on a given client (so the dropdown doesn't show dupes). */
export async function listAssignableEmployees(excludeClientId?: number | null): Promise<AssignableEmployee[]> {
  try {
    const platform = getPlatformDb();
    const [admins] = await platform.execute<AdminRow[]>(
      `SELECT user_id, email, display_name
         FROM admin_users
        WHERE role = 'staff' AND is_active = 1
        ORDER BY display_name ASC, email ASC`
    );
    if (admins.length === 0) return [];

    const uids = admins.map((a) => Number(a.user_id));
    const placeholders = uids.map(() => '?').join(', ');

    const av = getAvDb();
    const [profiles] = await av.execute<ProfileRow[]>(
      `SELECT user_id, title FROM employee_profiles WHERE user_id IN (${placeholders})`,
      uids
    );
    const titleByUid = new Map<number, string | null>();
    for (const p of profiles) titleByUid.set(Number(p.user_id), p.title);

    let excludeSet = new Set<number>();
    if (excludeClientId && Number.isInteger(excludeClientId) && excludeClientId > 0) {
      const [existing] = await av.execute<AssignmentRow[]>(
        `SELECT user_id FROM account_employees WHERE client_id = ?`,
        [excludeClientId]
      );
      excludeSet = new Set(existing.map((e) => Number(e.user_id)));
    }

    return admins
      .map((a) => ({
        userId: Number(a.user_id),
        displayName: a.display_name || a.email,
        email: a.email,
        title: titleByUid.get(Number(a.user_id)) ?? null
      }))
      .filter((e) => !excludeSet.has(e.userId));
  } catch {
    return [];
  }
}

/** The employees currently assigned to a client account, with their roles +
 *  display info. Used by the operator UI list. The CLIENT widget uses
 *  `listEmployeesForClient` from `lib/client/employees_on_account.ts` which
 *  also adds live work stats — this one is the lighter operator-side fetch. */
export async function listAccountEmployees(clientId: number): Promise<AccountEmployeeAssignment[]> {
  if (!Number.isInteger(clientId) || clientId <= 0) return [];
  try {
    const av = getAvDb();
    const [rows] = await av.execute<AssignmentRow[]>(
      `SELECT user_id, role, assigned_at
         FROM account_employees
        WHERE client_id = ?
        ORDER BY
          CASE role WHEN 'primary_rep' THEN 0 WHEN 'rep' THEN 1 ELSE 2 END,
          assigned_at ASC`,
      [clientId]
    );
    if (rows.length === 0) return [];

    const uids = rows.map((r) => Number(r.user_id));
    const placeholders = uids.map(() => '?').join(', ');

    const [profiles] = await av.execute<ProfileRow[]>(
      `SELECT user_id, title FROM employee_profiles WHERE user_id IN (${placeholders})`,
      uids
    );
    const titleByUid = new Map<number, string | null>();
    for (const p of profiles) titleByUid.set(Number(p.user_id), p.title);

    const platform = getPlatformDb();
    const [admins] = await platform.execute<AdminRow[]>(
      `SELECT user_id, email, display_name FROM admin_users WHERE user_id IN (${placeholders})`,
      uids
    );
    const adminByUid = new Map<number, AdminRow>();
    for (const a of admins) adminByUid.set(Number(a.user_id), a);

    return rows.map((r) => {
      const uid = Number(r.user_id);
      const a = adminByUid.get(uid);
      const assignedAt = r.assigned_at instanceof Date ? r.assigned_at : new Date(r.assigned_at);
      return {
        userId: uid,
        displayName: a?.display_name || a?.email || `Employee #${uid}`,
        email: a?.email ?? null,
        title: titleByUid.get(uid) ?? null,
        role: r.role,
        assignedAt: assignedAt.toISOString()
      };
    });
  } catch {
    return [];
  }
}

export interface AssignEmployeeResult {
  ok: boolean;
  created: boolean;
  demotedPriorPrimary: number | null;  // user_id of the previous primary_rep, if we demoted one
  error?: string;
}

/** Assign an employee to a client account at a role. If `role='primary_rep'`
 *  and another employee already holds it on this client, the prior holder is
 *  demoted to `rep` so there's never more than one primary. Idempotent: re-
 *  assigning the same user to the same role is a no-op + returns created=false. */
export async function assignEmployee(
  clientId: number,
  userId: number,
  role: AccountEmployeeRole
): Promise<AssignEmployeeResult> {
  if (!Number.isInteger(clientId) || clientId <= 0) return { ok: false, created: false, demotedPriorPrimary: null, error: 'bad client_id' };
  if (!Number.isInteger(userId) || userId <= 0) return { ok: false, created: false, demotedPriorPrimary: null, error: 'bad user_id' };
  if (role !== 'primary_rep' && role !== 'rep' && role !== 'support') {
    return { ok: false, created: false, demotedPriorPrimary: null, error: 'bad role' };
  }

  try {
    const av = getAvDb();

    // Verify the admin_user exists and is active staff before writing.
    const platform = getPlatformDb();
    const [admins] = await platform.execute<AdminRow[]>(
      `SELECT user_id FROM admin_users WHERE user_id = ? AND role = 'staff' AND is_active = 1 LIMIT 1`,
      [userId]
    );
    if (admins.length === 0) {
      return { ok: false, created: false, demotedPriorPrimary: null, error: 'employee not found / not active' };
    }

    let demotedPriorPrimary: number | null = null;
    if (role === 'primary_rep') {
      const [priors] = await av.execute<AssignmentRow[]>(
        `SELECT user_id FROM account_employees
          WHERE client_id = ? AND role = 'primary_rep' AND user_id <> ? LIMIT 1`,
        [clientId, userId]
      );
      if (priors.length > 0) {
        demotedPriorPrimary = Number(priors[0].user_id);
        await av.execute<ResultSetHeader>(
          `UPDATE account_employees SET role = 'rep'
            WHERE client_id = ? AND user_id = ?`,
          [clientId, demotedPriorPrimary]
        );
      }
    }

    // Upsert. ON DUPLICATE KEY updates role only (preserves assigned_at).
    const [res] = await av.execute<ResultSetHeader>(
      `INSERT INTO account_employees (client_id, user_id, role)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE role = VALUES(role)`,
      [clientId, userId, role]
    );

    // mysql2 returns affectedRows=1 for INSERT, 2 for UPDATE; created when 1.
    const created = res.affectedRows === 1;
    return { ok: true, created, demotedPriorPrimary };
  } catch (e) {
    return { ok: false, created: false, demotedPriorPrimary: null, error: (e as Error).message };
  }
}

/** Remove an employee from a client account. Their leads stay assigned to
 *  them — we don't unassign leads on team-removal, since that would lose
 *  the call history and surprise the rep. Operator can release leads
 *  separately via the existing ReleaseLeadsPanel. */
export async function unassignEmployee(clientId: number, userId: number): Promise<{ ok: boolean; deleted: boolean; error?: string }> {
  if (!Number.isInteger(clientId) || clientId <= 0) return { ok: false, deleted: false, error: 'bad client_id' };
  if (!Number.isInteger(userId) || userId <= 0) return { ok: false, deleted: false, error: 'bad user_id' };
  try {
    const av = getAvDb();
    const [res] = await av.execute<ResultSetHeader>(
      `DELETE FROM account_employees WHERE client_id = ? AND user_id = ?`,
      [clientId, userId]
    );
    return { ok: true, deleted: res.affectedRows > 0 };
  } catch (e) {
    return { ok: false, deleted: false, error: (e as Error).message };
  }
}
