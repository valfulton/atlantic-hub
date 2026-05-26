/**
 * lib/av/client_access.ts
 *
 * Operator control of a client's access: tier, a trial/comp window, extend, and
 * enable/disable (revoke). The portal reads client_users.tier for features, so
 * "give them the full package" means raising that tier; the access WINDOW lives
 * on clients.access_until + clients.enabled.
 *
 *   active = enabled AND (access_until IS NULL OR access_until >= today)
 *
 * See schema/042_client_access.sql.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type { ClientTier } from '@/lib/client-portal/tiers';

/** clients.plan_tier has no 'audit_only' — map it to the nearest paid tier. */
function toPlanTier(t: ClientTier): 'sprint' | 'momentum' | 'scale' {
  return t === 'audit_only' ? 'sprint' : t;
}

export interface ClientAccessState {
  enabled: boolean;
  accessUntil: string | null; // 'YYYY-MM-DD' or null (no expiry)
  active: boolean;            // enabled AND not expired
  expired: boolean;           // had a window and it passed
  planTier: string | null;
  leadMonthlyCap: number | null; // per-account override; null = use tier default
}

/** Read a client's current access state. Never throws to callers via try/catch
 *  at the call site; here it returns a safe "active" default on missing row so
 *  we never accidentally lock someone out due to a read glitch. */
export async function getClientAccessState(clientId: number): Promise<ClientAccessState> {
  const safe: ClientAccessState = { enabled: true, accessUntil: null, active: true, expired: false, planTier: null, leadMonthlyCap: null };
  if (!Number.isInteger(clientId) || clientId <= 0) return safe;
  let r: { enabled: unknown; access_until: string | null; plan_tier: string | null; lead_monthly_cap: number | string | null } | undefined;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { enabled: unknown; access_until: string | null; plan_tier: string | null; lead_monthly_cap: number | string | null })[]>(
      `SELECT enabled, access_until, plan_tier, lead_monthly_cap FROM clients WHERE client_id = ? AND archived_at IS NULL LIMIT 1`,
      [clientId]
    );
    r = rows[0];
  } catch {
    // e.g. migration 042/049 not run yet (no access_until / lead_monthly_cap
    // column). Fail OPEN — never lock a client out due to a schema/read glitch.
    return safe;
  }
  if (!r) return safe; // unknown client -> don't block (other guards handle missing accounts)

  const enabled = r.enabled === 1 || r.enabled === true || r.enabled === '1';
  const accessUntil = r.access_until ? String(r.access_until).slice(0, 10) : null;
  let expired = false;
  if (accessUntil) {
    const today = new Date().toISOString().slice(0, 10);
    expired = accessUntil < today; // string compare works for YYYY-MM-DD
  }
  const capNum = r.lead_monthly_cap == null ? null : Number(r.lead_monthly_cap);
  const leadMonthlyCap = capNum != null && Number.isFinite(capNum) && capNum >= 0 ? Math.trunc(capNum) : null;
  return { enabled, accessUntil, active: enabled && !expired, expired, planTier: r.plan_tier ?? null, leadMonthlyCap };
}

/**
 * Read ONLY the per-account monthly lead cap override (null = use tier default).
 * Used by the client discovery route to compute the effective cap without
 * pulling the full access state. Fails open (null) on any read/schema glitch.
 */
export async function getClientLeadCapOverride(clientId: number): Promise<number | null> {
  if (!Number.isInteger(clientId) || clientId <= 0) return null;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { lead_monthly_cap: number | string | null })[]>(
      `SELECT lead_monthly_cap FROM clients WHERE client_id = ? AND archived_at IS NULL LIMIT 1`,
      [clientId]
    );
    const v = rows[0]?.lead_monthly_cap;
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
  } catch {
    return null;
  }
}

export interface SetAccessInput {
  enabled?: boolean;
  /** Set an explicit expiry date 'YYYY-MM-DD', or null to clear (no expiry). */
  accessUntil?: string | null;
  /** Grant/extend a window of N days FROM TODAY (overrides accessUntil). */
  grantDays?: number;
  /** Raise/lower the client's portal tier (applied to all their client_users). */
  tier?: ClientTier;
  /**
   * Per-account monthly lead-discovery cap. A non-negative integer overrides the
   * tier default (raise OR lower); null clears the override (back to tier default).
   * `undefined` leaves it unchanged.
   */
  leadMonthlyCap?: number | null;
}

const VALID_TIERS: ClientTier[] = ['audit_only', 'sprint', 'momentum', 'scale'];

/** Apply an operator access change. Returns the resulting state. */
export async function setClientAccess(clientId: number, input: SetAccessInput): Promise<ClientAccessState> {
  if (!Number.isInteger(clientId) || clientId <= 0) throw new Error('invalid client id');
  const db = getAvDb();

  if (typeof input.enabled === 'boolean') {
    await db.execute<ResultSetHeader>(`UPDATE clients SET enabled = ? WHERE client_id = ?`, [input.enabled ? 1 : 0, clientId]);
  }

  if (typeof input.grantDays === 'number' && input.grantDays > 0) {
    await db.execute<ResultSetHeader>(
      `UPDATE clients SET access_until = DATE_ADD(CURDATE(), INTERVAL ? DAY), enabled = 1 WHERE client_id = ?`,
      [Math.trunc(input.grantDays), clientId]
    );
  } else if (input.accessUntil !== undefined) {
    const val = input.accessUntil && /^\d{4}-\d{2}-\d{2}$/.test(input.accessUntil) ? input.accessUntil : null;
    await db.execute<ResultSetHeader>(`UPDATE clients SET access_until = ? WHERE client_id = ?`, [val, clientId]);
  }

  if (input.leadMonthlyCap !== undefined) {
    // null clears the override (tier default); a non-negative integer sets it.
    const cap =
      input.leadMonthlyCap === null
        ? null
        : Number.isFinite(input.leadMonthlyCap) && (input.leadMonthlyCap as number) >= 0
          ? Math.trunc(input.leadMonthlyCap as number)
          : null;
    await db.execute<ResultSetHeader>(`UPDATE clients SET lead_monthly_cap = ? WHERE client_id = ?`, [cap, clientId]);
  }

  if (input.tier && VALID_TIERS.includes(input.tier)) {
    // Portal features read client_users.tier; raise every holder for this client.
    await db.execute<ResultSetHeader>(
      `UPDATE client_users SET tier = ? WHERE client_id = ? AND archived_at IS NULL`,
      [input.tier, clientId]
    );
    await db.execute<ResultSetHeader>(`UPDATE clients SET plan_tier = ? WHERE client_id = ?`, [toPlanTier(input.tier), clientId]);
  }

  return getClientAccessState(clientId);
}
