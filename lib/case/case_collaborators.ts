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
import { buildMagicLinkUrl } from '@/lib/auth/client-magic-token';

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
  /** (val 2026-06-14, #657) Which of the invitee's brands does this work belong to?
   *  For multi-brand owners (Adriana = CBB + CLDA) this scopes the matter to ONE brand
   *  so the case doesn't bleed across their dashboards. The invite UI should show a
   *  brand picker when the invitee owns 2+ brands; default to their current primary.
   *  Single-brand invitees (Rebecca, parents): leave NULL — no scoping needed. */
  viaClientId?: number | null;
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

    // 1. Upsert the client_users row. If an existing user is invited to a case
    //    we issue a fresh magic_token so the invite link works, but we do NOT
    //    re-bind their client_id — that would clobber a brand-owner's primary
    //    brand (val 2026-06-14, #657: Adriana invited to Johnson got her primary
    //    client_id repointed from CBB(9) to Johnson(18), breaking her dashboard
    //    home + popover). The collaborator relationship lives in
    //    family_case_collaborators below, scoped via via_client_id; primary
    //    brand context stays where it was.
    await db.execute<ResultSetHeader>(
      `INSERT INTO client_users
         (client_id, email, display_name, magic_token, magic_token_expires_at, tier)
       VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), 'audit_only')
       ON DUPLICATE KEY UPDATE
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
    //    (val 2026-06-14, #657) via_client_id scopes this matter to ONE of a
    //    multi-brand owner's brands so it doesn't bleed across all their
    //    dashboards. NULL = no scoping (single-brand invitees). The matters
    //    loader uses this column; see schema/094_collaborator_via_client_id.sql.
    const parentApproved = input.bypassParentApproval ? 1 : 0;
    const parentApprovedAt = input.bypassParentApproval ? 'NOW()' : 'NULL';
    const viaClientId = (typeof input.viaClientId === 'number' && input.viaClientId > 0)
      ? input.viaClientId
      : null;
    await db.execute<ResultSetHeader>(
      `INSERT INTO family_case_collaborators (
         case_id, client_user_id, role, invited_by_user_id,
         invitation_accepted, parent_approved, parent_approved_at,
         via_client_id, permissions
       ) VALUES (?, ?, ?, ?, FALSE, ?, ${parentApprovedAt}, ?, ?)
       ON DUPLICATE KEY UPDATE
         role = VALUES(role),
         invited_by_user_id = VALUES(invited_by_user_id),
         parent_approved = VALUES(parent_approved),
         parent_approved_at = VALUES(parent_approved_at),
         via_client_id = COALESCE(VALUES(via_client_id), via_client_id),
         permissions = VALUES(permissions),
         revoked_at = NULL`,
      [input.caseId, clientUserId, role, input.inviterUserId, parentApproved, viaClientId, JSON.stringify(perms)]
    );

    // 4. Read back the collaborator id we just touched.
    const [collabRows] = await db.execute<CollaboratorRow[]>(
      `SELECT collaborator_id FROM family_case_collaborators
        WHERE case_id = ? AND client_user_id = ? LIMIT 1`,
      [input.caseId, clientUserId]
    );
    const collaboratorId = collabRows[0]?.collaborator_id ?? null;

    // (val 2026-06-13) Use the canonical buildMagicLinkUrl — points at
    // /api/client/magic-link/{token} which actually consumes the token and
    // sets the session cookie. The earlier hand-rolled `/client/login?token=`
    // was DEAD: it just rendered the login form with an ignored query param,
    // which is why Rebecca's invite link "didn't work". Same fix in
    // components/case/CollaboratorsPanel.tsx.
    const magicLink = buildMagicLinkUrl(token);

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

/**
 * (val 2026-06-13, #636) Resolve what role a client_user has on a case so the
 * page render can apply the correct visibility filter.
 *
 *  parent              — brand owner OR collaborator role='parent'.
 *                        Sees parents_safe items only.
 *  account_rep         — A&V account manager (sibling_admin / primary_caregiver
 *                        collaborator roles, OR matched by account_employees
 *                        once unified-identity ships). Sees everything.
 *  professional        — attorney / advisor collaborator. Sees parents_safe
 *                        only (outside counsel — not internal operator).
 *  family              — sibling_reader / sibling_commenter / advisor.
 *                        Sees parents_safe only.
 *  operator            — val. Used when no ?as is supplied. Sees everything.
 *  unknown             — fallback when client_user has no relationship to
 *                        the case. Sees nothing (forced empty).
 */
export type CaseViewerRole =
  | 'parent'
  | 'account_rep'
  | 'professional'
  | 'family'
  | 'operator'
  | 'unknown';

interface CollabRoleRow extends RowDataPacket {
  role: string;
  revoked_at: string | null;
  parent_approved: 0 | 1;
}

export async function resolveCaseViewerRole(
  clientUserId: number,
  caseId: number,
  caseClientId: number | null
): Promise<CaseViewerRole> {
  if (!Number.isInteger(clientUserId) || clientUserId <= 0) return 'unknown';
  if (!Number.isInteger(caseId) || caseId <= 0) return 'unknown';

  try {
    const db = getAvDb();

    // Brand owner shortcut — if their client_users.client_id matches the
    // case's client_id, they're a parent/owner.
    if (caseClientId) {
      const [ownerRows] = await db.execute<RowDataPacket[]>(
        `SELECT 1 FROM client_users
          WHERE client_user_id = ? AND client_id = ? LIMIT 1`,
        [clientUserId, caseClientId]
      );
      if (ownerRows.length > 0) return 'parent';
    }

    // Otherwise check family_case_collaborators for the case-scoped role.
    const [rows] = await db.execute<CollabRoleRow[]>(
      `SELECT role, revoked_at, parent_approved
         FROM family_case_collaborators
        WHERE client_user_id = ? AND case_id = ?
        LIMIT 1`,
      [clientUserId, caseId]
    );
    const row = rows[0];
    if (!row || row.revoked_at) return 'unknown';

    switch (row.role) {
      case 'parent':
        return 'parent';
      case 'sibling_admin':
      case 'primary_caregiver':
      case 'successor_trustee':
        // Account-rep roles (fiduciary working layer). Rebecca's
        // sibling_admin lands here. See all items including operator_only.
        return 'account_rep';
      case 'attorney':
      case 'advisor':
        return 'professional';
      case 'sibling_reader':
      case 'sibling_commenter':
        return 'family';
      default:
        return 'family';
    }
  } catch (err) {
    console.error('resolveCaseViewerRole failed', err);
    return 'unknown';
  }
}

/**
 * Whether a case viewer is allowed to edit case documents (markdown drafts).
 *   (val 2026-06-15, #679)
 *
 *   account_rep   — Rebecca (successor_trustee), sibling_admin, primary_caregiver.
 *                   Trusted working layer. Edit allowed.
 *   professional  — Adriana (attorney/advisor). Trusted outside professional.
 *                   Edit allowed.
 *   parent        — Gordon + Maria. Lifetime beneficiaries. READ-ONLY so
 *                   they can't accidentally destroy information while
 *                   navigating the case file. (val's words: "i dont want
 *                   the information lost.")
 *   family        — Other family members at large. READ-ONLY by default
 *                   until they're explicitly promoted.
 *   operator      — val. Always allowed (operator viewer enforces this
 *                   separately; this branch is here for completeness).
 *   unknown       — Block.
 */
export function canEditCaseDocuments(role: CaseViewerRole): boolean {
  return role === 'account_rep' || role === 'professional' || role === 'operator';
}

/**
 * Maps a viewer role to the visibility levels they're allowed to see.
 * Renderers filter case items by `visibility IN visibleFor(role)`.
 *
 * (val 2026-06-15, #685) Three tiers now:
 *   parents_safe  — every viewer who can see the case (parents included)
 *   legal_team    — operator + account_rep + professional (Rebecca + Adriana + val).
 *                   The "Investigation" surface uses this. Hidden from parents.
 *   operator_only — operator + account_rep only (Rebecca + val). Hidden from Adriana too.
 */
export function visibleFor(role: CaseViewerRole): ('parents_safe' | 'operator_only' | 'legal_team')[] {
  switch (role) {
    case 'operator':
    case 'account_rep':
      // Internal/A&V eyes — full visibility (val + Rebecca).
      return ['parents_safe', 'operator_only', 'legal_team'];
    case 'professional':
      // Adriana — investigation lane + parent-safe. Operator-only items stay
      // hidden so val + Rebecca can keep notes Adriana shouldn't see.
      return ['parents_safe', 'legal_team'];
    case 'parent':
    case 'family':
      // Lifetime beneficiaries + extended family — parent-safe only.
      return ['parents_safe'];
    case 'unknown':
      // No relationship — nothing.
      return [];
  }
}

/**
 * (val 2026-06-13, #636) Return every client_user who could plausibly be a
 * "View as" target on this case — brand owner + active collaborators. Used
 * to populate the ViewAsPicker dropdown on the operator preview page.
 */
export interface ViewAsCandidate {
  clientUserId: number;
  email: string;
  displayName: string | null;
  /** Pre-resolved role label so the picker doesn't need a second query. */
  role: CaseViewerRole;
}

interface CandidateRow extends RowDataPacket {
  client_user_id: number;
  email: string;
  display_name: string | null;
  source: 'brand_owner' | 'collaborator';
  collab_role: string | null;
}

export async function listViewAsCandidates(
  caseId: number,
  caseClientId: number | null
): Promise<ViewAsCandidate[]> {
  if (!Number.isInteger(caseId) || caseId <= 0) return [];
  try {
    const db = getAvDb();

    // Param order MUST match the order of `?` in the final SQL:
    //   1. main SELECT's fcc.case_id = ?
    //   2. union SELECT's cu.client_id = ?  (only when caseClientId is present)
    const params: number[] = [caseId];
    let ownerSel = '';
    if (caseClientId) {
      ownerSel = `
        UNION
        SELECT
          cu.client_user_id, cu.email, cu.display_name,
          'brand_owner' AS source, NULL AS collab_role
        FROM client_users cu
        WHERE cu.client_id = ? AND cu.archived_at IS NULL`;
      params.push(caseClientId);
    }

    const [rows] = await db.query<CandidateRow[]>(
      `SELECT
          cu.client_user_id, cu.email, cu.display_name,
          'collaborator' AS source, fcc.role AS collab_role
        FROM family_case_collaborators fcc
        JOIN client_users cu ON cu.client_user_id = fcc.client_user_id
        WHERE fcc.case_id = ? AND fcc.revoked_at IS NULL
        ${ownerSel}`,
      params
    );

    const seen = new Set<number>();
    const out: ViewAsCandidate[] = [];
    for (const r of rows) {
      if (seen.has(r.client_user_id)) continue;
      seen.add(r.client_user_id);
      out.push({
        clientUserId: r.client_user_id,
        email: r.email,
        displayName: r.display_name,
        role: roleFromSource(r.source, r.collab_role)
      });
    }
    return out;
  } catch (err) {
    console.error('listViewAsCandidates failed', err);
    return [];
  }
}

function roleFromSource(
  source: 'brand_owner' | 'collaborator',
  collabRole: string | null
): CaseViewerRole {
  if (source === 'brand_owner') return 'parent';
  switch (collabRole) {
    case 'parent': return 'parent';
    case 'sibling_admin':
    case 'primary_caregiver':
    case 'successor_trustee': return 'account_rep';
    case 'attorney':
    case 'advisor': return 'professional';
    case 'sibling_reader':
    case 'sibling_commenter': return 'family';
    default: return 'family';
  }
}

/**
 * Is this case reachable when viewing as the given client_id?  (val 2026-06-14, #659)
 *
 * The matters card surfaces a case when:
 *   1. case.client_id == viewer's active brand (case home), OR
 *   2. via_client_id IS NULL (single-brand collaborator), OR
 *   3. via_client_id == viewer's active brand (work-context match)
 *
 * The operator preview route (`/admin/av/clients/[clientId]/preview/cases/[caseId]`)
 * needs the same rule, NOT just the case-home equality. Without this,
 * `clients/10/preview/cases/1` 404s when Johnson is homed on AV Real Estate
 * (client_id 13) even though Adriana sees it on CLDA via fcc.via_client_id=10.
 *
 * Returns true if EITHER condition holds:
 *   - the case's own client_id equals the viewer's brand
 *   - a non-revoked collaborator row exists for this case with
 *     via_client_id = viewer's brand (OR via_client_id IS NULL, single-brand
 *     collaborator who happens to BE the case home — covered by clause 1)
 */
export async function caseAccessibleAsClient(
  caseId: number,
  clientId: number,
  caseHomeClientId: number | null
): Promise<boolean> {
  if (!Number.isInteger(caseId) || caseId <= 0) return false;
  if (!Number.isInteger(clientId) || clientId <= 0) return false;

  // Clause 1: case's own home matches the viewer brand.
  if (caseHomeClientId && caseHomeClientId === clientId) return true;

  // Clause 3: collaborator row brand-scoped to this viewer brand.
  // (Clause 2 — via_client_id IS NULL — would surface the case on EVERY brand
  // the collaborator's owner switches into, including brands they don't work
  // this case from. That's the bleed #657 fixed. So in operator preview we
  // ONLY honor explicit via_client_id matches; the dashboard loader keeps
  // honoring NULL as "no scoping" for single-brand collaborators.)
  try {
    const db = getAvDb();
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1
         FROM family_case_collaborators
        WHERE case_id = ?
          AND via_client_id = ?
          AND revoked_at IS NULL
        LIMIT 1`,
      [caseId, clientId]
    );
    return rows.length > 0;
  } catch (err) {
    console.error('caseAccessibleAsClient failed', err);
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
