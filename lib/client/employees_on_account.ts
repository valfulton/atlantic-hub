/**
 * lib/client/employees_on_account.ts  (#377)
 *
 * Surfaces the AV employees currently working a client's account so the client
 * sees "Your A&V team — Rebecca is on it" on their dashboard. Powers Adriana's
 * Model-B rep demo: Rebecca stays as a platform `admin_users` employee, no
 * client_user parallel; we derive who's-on-this-account from the leads table.
 *
 * Two derivation paths, merged:
 *   1. Implicit  — DISTINCT admin_users assigned to any non-archived lead on
 *                  this client_id (the existing assignment fabric).
 *   2. Explicit  — `account_employees(client_id, user_id, role)` rows, if the
 *                  table exists (schema/074). Lets val mark a primary rep even
 *                  before any leads have been assigned. Implicit-only is fine.
 *
 * TWO DATABASES (load-bearing — same pattern as lib/employees/store.ts):
 *   - leads + call_log + employee_profiles + account_employees → AV db
 *     (shhdbite_AV). assigned_to_user_id is an FK to platform admin_users,
 *     enforced by the app, not the database.
 *   - admin_users (display_name) → platform db (shhdbite_atlantic_hub).
 *
 * Errors degrade to [] — the dashboard must never crash because a rep widget
 * can't load. Matches lib/client/team.ts.
 */
import { getAvDb } from '@/lib/db/av';
import { getPlatformDb } from '@/lib/db/platform';
import type { RowDataPacket } from 'mysql2';

export interface EmployeeOnAccount {
  userId: number;                  // platform admin_users.user_id
  displayName: string;             // platform admin_users.display_name
  title: string | null;            // AV employee_profiles.title (Sales Rep / SDR / etc.)
  role: 'primary_rep' | 'rep' | 'support' | 'implicit';
  leadsAssigned: number;           // open (non-archived) leads for this client + this user
  callsLast7Days: number;          // call_log entries by this user against those leads
  lastActivityAt: string | null;   // ISO — newest of call_log.called_at / leads.last_activity_at
}

interface UidRow extends RowDataPacket { uid: number }
interface ExplicitRow extends RowDataPacket { user_id: number; role: 'primary_rep' | 'rep' | 'support' }
interface AvCountsRow extends RowDataPacket {
  uid: number;
  leads_assigned: number | string;
  calls_7d: number | string;
  last_call_at: Date | string | null;
  last_lead_activity_at: Date | string | null;
}
interface ProfileRow extends RowDataPacket { user_id: number; title: string | null }
interface AdminUserRow extends RowDataPacket { user_id: number; display_name: string | null }

/**
 * List the AV employees on a given client account, with each rep's live work
 * stats (leads assigned, calls last 7 days, last activity).
 */
export async function listEmployeesForClient(clientId: number | null | undefined): Promise<EmployeeOnAccount[]> {
  if (!clientId || !Number.isInteger(clientId) || clientId <= 0) return [];

  try {
    const av = getAvDb();

    // 1) Implicit: every admin_user assigned to a non-archived lead on this client.
    const [implicit] = await av.execute<UidRow[]>(
      `SELECT DISTINCT assigned_to_user_id AS uid
         FROM leads
        WHERE client_id = ?
          AND assigned_to_user_id IS NOT NULL
          AND archived_at IS NULL`,
      [clientId]
    );

    // 2) Explicit: account_employees rows (table may not exist yet — guarded).
    let explicit: ExplicitRow[] = [];
    try {
      const [rows] = await av.execute<ExplicitRow[]>(
        `SELECT user_id, role FROM account_employees WHERE client_id = ?`,
        [clientId]
      );
      explicit = rows;
    } catch {
      /* table not deployed yet — fine, implicit covers the demo */
    }

    // Merge: explicit role wins over implicit; otherwise tag as 'implicit'.
    const roleByUid = new Map<number, EmployeeOnAccount['role']>();
    for (const r of explicit) roleByUid.set(Number(r.user_id), r.role);
    for (const r of implicit) {
      const uid = Number(r.uid);
      if (!roleByUid.has(uid)) roleByUid.set(uid, 'implicit');
    }
    if (roleByUid.size === 0) return [];

    const uids = Array.from(roleByUid.keys());
    const placeholders = uids.map(() => '?').join(', ');

    // 3) Per-user counts in one round trip. last_activity_at on leads exists
    //    (used by sales/rep_dashboard.ts and updated by assign_discovered.ts).
    const [counts] = await av.execute<AvCountsRow[]>(
      `SELECT
          l.assigned_to_user_id            AS uid,
          COUNT(DISTINCT l.id)              AS leads_assigned,
          (SELECT COUNT(*) FROM call_log c
             WHERE c.user_id = l.assigned_to_user_id
               AND c.lead_id IN (
                 SELECT id FROM leads
                  WHERE client_id = ?
                    AND assigned_to_user_id = l.assigned_to_user_id
                    AND archived_at IS NULL
               )
               AND c.called_at >= (NOW() - INTERVAL 7 DAY)) AS calls_7d,
          (SELECT MAX(c.called_at) FROM call_log c
             WHERE c.user_id = l.assigned_to_user_id
               AND c.lead_id IN (
                 SELECT id FROM leads
                  WHERE client_id = ?
                    AND assigned_to_user_id = l.assigned_to_user_id
                    AND archived_at IS NULL
               )) AS last_call_at,
          MAX(l.last_activity_at) AS last_lead_activity_at
        FROM leads l
       WHERE l.client_id = ?
         AND l.archived_at IS NULL
         AND l.assigned_to_user_id IN (${placeholders})
       GROUP BY l.assigned_to_user_id`,
      [clientId, clientId, clientId, ...uids]
    );
    const countsByUid = new Map<number, AvCountsRow>();
    for (const c of counts) countsByUid.set(Number(c.uid), c);

    // 4) AV profile titles for whichever users we have rows for.
    const [profiles] = await av.execute<ProfileRow[]>(
      `SELECT user_id, title FROM employee_profiles WHERE user_id IN (${placeholders})`,
      uids
    );
    const titleByUid = new Map<number, string | null>();
    for (const p of profiles) titleByUid.set(Number(p.user_id), p.title);

    // 5) Platform display names — separate connection.
    const platform = getPlatformDb();
    const [admins] = await platform.execute<AdminUserRow[]>(
      `SELECT user_id, display_name FROM admin_users WHERE user_id IN (${placeholders})`,
      uids
    );
    const nameByUid = new Map<number, string>();
    for (const a of admins) {
      if (a.display_name) nameByUid.set(Number(a.user_id), a.display_name);
    }

    // 6) Merge + sort: primary_rep first, then by leads desc, then by name.
    const out: EmployeeOnAccount[] = [];
    for (const uid of uids) {
      const c = countsByUid.get(uid);
      const lastCall = c?.last_call_at ? new Date(c.last_call_at) : null;
      const lastLead = c?.last_lead_activity_at ? new Date(c.last_lead_activity_at) : null;
      const lastActivity = pickLatest(lastCall, lastLead);
      out.push({
        userId: uid,
        displayName: nameByUid.get(uid) ?? `Employee #${uid}`,
        title: titleByUid.get(uid) ?? null,
        role: roleByUid.get(uid) ?? 'implicit',
        leadsAssigned: Number(c?.leads_assigned ?? 0) || 0,
        callsLast7Days: Number(c?.calls_7d ?? 0) || 0,
        lastActivityAt: lastActivity ? lastActivity.toISOString() : null
      });
    }

    const ROLE_ORDER: Record<EmployeeOnAccount['role'], number> = {
      primary_rep: 0,
      rep: 1,
      implicit: 2,
      support: 3
    };
    out.sort((a, b) => {
      const r = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
      if (r !== 0) return r;
      if (a.leadsAssigned !== b.leadsAssigned) return b.leadsAssigned - a.leadsAssigned;
      return a.displayName.localeCompare(b.displayName);
    });
    return out;
  } catch {
    // Same safety net as lib/client/team.ts — dashboard must keep rendering.
    return [];
  }
}

function pickLatest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}
