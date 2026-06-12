/**
 * lib/case/case_collaborators.ts  (val 2026-06-12, Phase 3 Wave 3)
 *
 * Family-case collaborator management. The schema lives in 089 as
 * family_case_collaborators. This module handles:
 *   - inviting a sibling (creates the client_user if missing, inserts a
 *     family_case_collaborators row in pending state, returns the magic
 *     link the operator hands off)
 *   - listing collaborators for a case (with roles + parent-approval status)
 *   - marking parent_approved / revoking
 *
 * Pending state rule: every invite starts with `parent_approved = FALSE`
 * unless the inviter is the operator acting on behalf of a parent (the
 * parent-approval gate per the elder-advocacy spec). The UI must enforce
 * "parent must say yes before this person sees the case."
 */
import { getAvDb } from '@/lib/db/av';
import { randomBytes } from 'node:crypto';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export type CollaboratorRole =
  | 'parent'
  | 'primary_caregiver'
  | 'successor_trustee'
  | 'sibling_reader'
  | 'sibling_commenter'
  | 'sibling_admin'
  | 'advisor'
  | 'attorney';

export const DEFAULT_PERMISSIONS_BY_ROLE: Record<CollaboratorRole, Record<string, boolean>> = {
  parent: {
    can_view: true, can_comment: true, can_upload: true, can_invite: true,
    can_log_wellness: true, can_log_financials: true, can_view_health_detail: true
  },
  primary_caregiver: {
    can_view: true, can_comment: true, can_upload: true, can_invite: true,
    can_log_wellness: true, can_log_financials: true, can_view_health_detail: true
  },
  successor_trustee: {
    can_view: true, can_comment: true, can_upload: true, can_invite: true,
    can_log_wellness: true, can_log_financials: true, can_view_health_detail: true
  },
  sibling_admin: {
    can_view: true, can_comment: true, can_upload: true, can_invite: true,
    can_log_wellness: true, can_log_financials: true, can_view_health_detail: false
  },
  sibling_commenter: {
    can_view: true, can_comment: true, can_upload: false, can_invite: false,
    can_log_wellness: true, can_log_financials: false, can_view_health_detail: false
  },
  sibling_reader: {
    can_view: true, can_comment: false, can_upload: false, can_invite: false,
    can_log_wellness: false, can_log_financials: false, can_view_health_detail: false
  },
  advisor: {
    can_view: true, can_comment: true, can_upload: true, can_invite: false,
    can_log_wellness: false, can_log_financials: true, can_view_health_detail: false
  },
  attorney: {
    can_view: true, can_comment: true, can_upload: true, can_invite: false,
    can_log_wellness: false, can_log_financials: true, can_view_health_detail: true
  }
};

export interface CollaboratorRecord {
  collaboratorId: number;
  caseId: number;
  clientUserId: number;
  email: string;
  displayName: string | null;
  role: string;
  invitationAccepted: boolean;
  acceptedAt: string | null;
  parentApproved: boolean;
  parentApprovedAt: string | null;
  revokedAt: string | null;
  permissions: Record<string, boolean>;
  magicToken: string | null;
  magicTokenExpiresAt: string | null;
}

interface CollaboratorRow extends RowDataPacket {
  collaborator_id: number;
  case_id: number;
  client_user_id: number;
  role: string;
  invitation_accepted: number | boolean;
  accepted_at: Date | string | null;
  parent_approved: number | boolean;
  parent_approved_at: Date | string | null;
  revoked_at: Date | string | null;
  permissions: string | null;
  email: string;
  display_name: string | null;
  magic_token: string | null;
  magic_token_expires_at: Date | string | null;
}

interface UserRow extends RowDataPacket {
  client_user_id: number;
}

function toIso(v: Date | string | null): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v;
  try { return v.toISOString(); } catch { return null; }
}

function genToken(): string {
  return randomBytes(32).toString('hex');
}

function parsePerms(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw);
    return (typeof j === 'object' && j) ? j : {};
  } catch { return {}; }
}

/** List collaborators for a case. Joins client_users for email/display_name. */
export async function listCollaboratorsForCase(caseId: number): Promise<CollaboratorRecord[]> {
  if (!Number.isInteger(caseId) || caseId <= 0) return [];
  try {
    const db = getAvDb();
    const [rows] = await db.execute<CollaboratorRow[]>(
      `SELECT
         fc.collaborator_id, fc.case_id, fc.client_user_id, fc.role,
         fc.invitation_accepted, fc.accepted_at,
         fc.parent_approved, fc.parent_approved_at,
         fc.revoked_at, fc.permissions,
         cu.email, cu.display_name,
         cu.magic_token, cu.magic_token_expires_at
       FROM family_case_collaborators fc
       JOIN client_users cu ON cu.client_user_id = fc.client_user_id
       WHERE fc.case_id = ?
       ORDER BY fc.invited_at DESC, fc.collaborator_id DESC`,
      [caseId]
    );
    return rows.map((r) => ({
      collaboratorId: r.collaborator_id,
      caseId: r.case_id,
      clientUserId: r.client_user_id,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      invitationAccepted: !!r.invitation_accepted,
      acceptedAt: toIso(r.accepted_at),
      parentApproved: !!r.parent_approved,
      parentApprovedAt: toIso(r.parent_approved_at),
      revokedAt: toIso(r.revoked_at),
      permissions: parsePerms(r.permissions),
      magicToken: r.magic_token,
      magicTokenExpiresAt: toIso(r.magic_token_expires_at)
    }));
  } catch (err) {
    console.error('listCollaboratorsForCase failed', err);
    return [];
  }
}

export interface InviteCollaboratorInput {
  caseId: number;
  clientId: number;
  inviterUserId: number;
  email: string;
  displayName: string | null;
  role: CollaboratorRole;
  /** When TRUE, marks parent_approved immediately. Operator-only path. */
  bypassParentApproval?: boolean;
}

export interface InviteResult {
  ok: boolean;
  collaboratorId: number | null;
  clientUserId: number | null;
  magicLink: string | null;
  error?: string;
}

/** Invite a sibling (or anyone else) to the case.
 *  - If a client_users row exists at that email, reuse it (attaches to this client_id).
 *  - Otherwise create a new client_users row with a fresh magic_token (30d TTL).
 *  - Insert family_case_collaborators with parent_approved per inviter rule.
 *  - Return the magic-link URL so the operator can hand it off.
 *
 *  Phase 4: replace manual hand-off with real email send via Outlook MCP.
 */
export async function inviteCollaborator(input: InviteCollaboratorInput): Promise<InviteResult> {
  if (!Number.isInteger(input.caseId) || input.caseId <= 0) {
    return { ok: false, collaboratorId: null, clientUserId: null, magicLink: null, error: 'bad case id' };
  }
  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, collaboratorId: null, clientUserId: null, magicLink: null, error: 'invalid email' };
  }
  const role = input.role;
  if (!Object.keys(DEFAULT_PERMISSIONS_BY_ROLE).includes(role)) {
    return { ok: false, collaboratorId: null, clientUserId: null, magicLink: null, error: 'invalid role' };
  }

  const token = genToken();
  const perms = DEFAULT_PERMISSIONS_BY_ROLE[role];

  try {
    const db = getAvDb();

    // 1. Upsert the client_users row. ON DUPLICATE KEY UPDATE re-binds them
    //    to this client_id + issues a fresh token so the magic link works.
    await db.execute<ResultSetHeader>(
      `INSERT INTO client_users
         (client_id, email, display_name, magic_token, magic_token_expires_at, tier)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), 'audit_only')
       ON DUPLICATE KEY UPDATE
         client_id = VALUES(client_id),
         display_name = COALESCE(VALUES(display_name), display_name),
         magic_token = VALUES(magic_token),
         magic_token_expires_at = VALUES(magic_token_expires_at)`,
      [input.clientId, email, input.displayName || null, token]
    );

    // 2. Fetch the resulting client_user_id (works whether we inserted or updated).
    const [userRows] = await db.execute<UserRow[]>(
      `SELECT client_user_id FROM client_users WHERE email = ? LIMIT 1`,
      [email]
    );
    const clientUserId = userRows[0]?.client_user_id ?? null;
    if (!clientUserId) {
      return { ok: false, collaboratorId: null, clientUserId: null, magicLink: null, error: 'client_user lookup failed' };
    }

    // 3. Upsert the collaborator row. Unique key is (case_id, client_user_id).
    const parentApproved = input.bypassParentApproval ? 1 : 0;
    const parentApprovedAt = input.bypassParentApproval ? 'NOW()' : 'NULL';
    await db.execute<ResultSetHeader>(
      `INSERT INTO family_case_collaborators (
         case_id, client_user_id, role, invited_by_user_id,
         invitation_accepted, parent_approved, parent_approved_at, permissions
       ) VALUES (?, ?, ?, ?, FALSE, ?, ${parentApprovedAt}, ?)
       ON DUPLICATE KEY UPDATE
         role = VALUES(role),
         invited_by_user_id = VALUES(invited_by_user_id),
         parent_approved = VALUES(parent_approved),
         parent_approved_at = VALUES(parent_approved_at),
         permissions = VALUES(permissions),
         revoked_at = NULL`,
      [input.caseId, clientUserId, role, input.inviterUserId, parentApproved, JSON.stringify(perms)]
    );

    // 4. Read back the collaborator id we just touched.
    const [collabRows] = await db.execute<CollaboratorRow[]>(
      `SELECT collaborator_id FROM family_case_collaborators
        WHERE case_id = ? AND client_user_id = ? LIMIT 1`,
      [input.caseId, clientUserId]
    );
    const collaboratorId = collabRows[0]?.collaborator_id ?? null;

    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://atlantic-hub.netlify.app';
    const magicLink = `${base.replace(/\/$/, '')}/client/login?token=${token}`;

    return { ok: true, collaboratorId, clientUserId, magicLink };
  } catch (err) {
    console.error('inviteCollaborator failed', err);
    return { ok: false, collaboratorId: null, clientUserId: null, magicLink: null, error: 'database error' };
  }
}

/** Mark a collaborator as parent_approved. Used when a parent comes online
 *  later (or when val acts on a parent's verbal say-so). */
export async function approveCollaborator(
  collaboratorId: number,
  approvingUserId: number
): Promise<boolean> {
  if (!Number.isInteger(collaboratorId) || collaboratorId <= 0) return false;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE family_case_collaborators
          SET parent_approved = TRUE,
              parent_approved_at = NOW(),
              parent_approved_by_user_id = ?
        WHERE collaborator_id = ?`,
      [approvingUserId, collaboratorId]
    );
    return res.affectedRows > 0;
  } catch (err) {
    console.error('approveCollaborator failed', err);
    return false;
  }
}

/** Soft-revoke a collaborator (sets revoked_at). */
export async function revokeCollaborator(collaboratorId: number): Promise<boolean> {
  if (!Number.isInteger(collaboratorId) || collaboratorId <= 0) return false;
  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE family_case_collaborators
          SET revoked_at = NOW()
        WHERE collaborator_id = ?`,
      [collaboratorId]
    );
    return res.affectedRows > 0;
  } catch (err) {
    console.error('revokeCollaborator failed', err);
    return false;
  }
}
