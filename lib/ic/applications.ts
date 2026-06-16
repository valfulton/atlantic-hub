/**
 * lib/ic/applications.ts (val 2026-06-16, #701)
 *
 * Store for Independent Contractor applications. Every /client/dashboard
 * surfaces an "Earn with A&V" card → /client/apply → POST here. Operator
 * reviews on /admin/av/ic-applications.
 *
 * Schema: schema/102_ic_applications.sql
 */
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { getAvDb } from '@/lib/db/av';

export type TierPref = 'caller' | 'manager' | 'referrer' | 'any';
export type ApplicationStatus = 'pending' | 'approved' | 'declined' | 'revoked';

export interface IcApplication {
  applicationId: number;
  clientUserId: number;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  tierPref: TierPref;
  pitch: string | null;
  appliedFromClientId: number | null;
  status: ApplicationStatus;
  statusAt: string | null;
  statusByUserId: number | null;
  reviewerNotes: string | null;
  linkedAdminUserId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface IcAppRow extends RowDataPacket {
  application_id: number;
  client_user_id: number;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  tier_pref: string;
  pitch: string | null;
  applied_from_client_id: number | null;
  status: string;
  status_at: Date | string | null;
  status_by_user_id: number | null;
  reviewer_notes: string | null;
  linked_admin_user_id: number | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function rowToApp(r: IcAppRow): IcApplication {
  return {
    applicationId: Number(r.application_id),
    clientUserId: Number(r.client_user_id),
    displayName: r.display_name,
    email: r.email,
    phone: r.phone,
    tierPref: (r.tier_pref as TierPref) || 'any',
    pitch: r.pitch,
    appliedFromClientId: r.applied_from_client_id == null ? null : Number(r.applied_from_client_id),
    status: (r.status as ApplicationStatus) || 'pending',
    statusAt: toIso(r.status_at),
    statusByUserId: r.status_by_user_id == null ? null : Number(r.status_by_user_id),
    reviewerNotes: r.reviewer_notes,
    linkedAdminUserId: r.linked_admin_user_id == null ? null : Number(r.linked_admin_user_id),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at)
  };
}

export interface CreateIcApplicationInput {
  clientUserId: number;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  tierPref: TierPref;
  pitch: string | null;
  appliedFromClientId: number | null;
}

/** Get the pending/approved application for a client_user (one open at a time). */
export async function getOpenApplicationForUser(clientUserId: number): Promise<IcApplication | null> {
  if (!Number.isInteger(clientUserId) || clientUserId <= 0) return null;
  const db = getAvDb();
  const [rows] = await db.execute<IcAppRow[]>(
    `SELECT * FROM ic_applications
      WHERE client_user_id = ? AND status IN ('pending','approved')
      ORDER BY created_at DESC LIMIT 1`,
    [clientUserId]
  );
  return rows[0] ? rowToApp(rows[0]) : null;
}

export async function createIcApplication(input: CreateIcApplicationInput): Promise<number | null> {
  if (!Number.isInteger(input.clientUserId) || input.clientUserId <= 0) return null;
  const db = getAvDb();
  // Refuse duplicate-pending submissions silently — return the existing row id.
  const existing = await getOpenApplicationForUser(input.clientUserId);
  if (existing) return existing.applicationId;
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO ic_applications
       (client_user_id, display_name, email, phone, tier_pref, pitch, applied_from_client_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.clientUserId,
      input.displayName,
      input.email,
      input.phone,
      input.tierPref,
      input.pitch,
      input.appliedFromClientId
    ]
  );
  return res.insertId || null;
}

export interface ListApplicationsFilter {
  status?: ApplicationStatus | 'all';
  limit?: number;
}

export async function listIcApplications(f: ListApplicationsFilter = {}): Promise<IcApplication[]> {
  const db = getAvDb();
  // (#706) mysql2 prepared-statement quirk: LIMIT bound as a parameter
  // throws ER_WRONG_ARGUMENTS on MariaDB. Inline the validated integer.
  const limit = Math.min(Math.max(Math.trunc(f.limit ?? 200) || 200, 1), 500);
  if (f.status && f.status !== 'all') {
    const [rows] = await db.execute<IcAppRow[]>(
      `SELECT * FROM ic_applications WHERE status = ? ORDER BY created_at DESC LIMIT ${limit}`,
      [f.status]
    );
    return rows.map(rowToApp);
  }
  const [rows] = await db.execute<IcAppRow[]>(
    `SELECT * FROM ic_applications ORDER BY created_at DESC LIMIT ${limit}`,
    []
  );
  return rows.map(rowToApp);
}

export async function updateIcApplicationStatus(
  applicationId: number,
  status: ApplicationStatus,
  statusByUserId: number,
  reviewerNotes?: string | null,
  linkedAdminUserId?: number | null
): Promise<boolean> {
  if (!Number.isInteger(applicationId) || applicationId <= 0) return false;
  const db = getAvDb();
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE ic_applications
        SET status = ?, status_at = NOW(), status_by_user_id = ?,
            reviewer_notes = COALESCE(?, reviewer_notes),
            linked_admin_user_id = COALESCE(?, linked_admin_user_id)
      WHERE application_id = ?`,
    [status, statusByUserId, reviewerNotes ?? null, linkedAdminUserId ?? null, applicationId]
  );
  return (res.affectedRows ?? 0) > 0;
}
