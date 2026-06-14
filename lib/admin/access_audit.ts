/**
 * lib/admin/access_audit.ts  (val 2026-06-13)
 *
 * Cross-client access audit. One read returns the truth for every
 * client_user the system knows about:
 *   - which brands they own / are a member of
 *   - which cases they're a collaborator on (with the access gates resolved)
 *   - whether their password is set
 *   - their magic-link token + expiry
 *   - whether they've actually logged in
 *
 * Then the audit page renders a row per user with PASS/BLOCKED badges so val
 * can see at a glance whether Rebecca/Adriana/parents will get past the
 * /client/cases/[id] auth + parent-approval gates BEFORE she sends them
 * the link. No more guessing.
 */
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export interface AccessAuditCase {
  caseId: number;
  caseName: string;
  caseClientId: number | null;
  /** Role on this case (sibling_admin / attorney / etc). */
  role: string;
  invitationAccepted: boolean;
  parentApproved: boolean;
  revokedAt: string | null;
  /** TRUE iff they would actually see this case in their /client/cases list
   *  AND be allowed past canClientUserAccessCase() on the detail page. */
  canReach: boolean;
  /** Plain-English reason if canReach=false. */
  blockedReason: string | null;
}

export interface AccessAuditBrand {
  clientId: number;
  clientName: string;
  /** 'owner' if client_users.client_id = this brand; 'member' if joined via brand_members. */
  rel: 'owner' | 'member';
}

export interface AccessAuditUser {
  clientUserId: number;
  email: string;
  displayName: string | null;
  primaryClientId: number | null;
  primaryClientName: string | null;
  tier: string | null;
  passwordSet: boolean;
  magicToken: string | null;
  magicTokenExpiresAt: string | null;
  lastLoginAt: string | null;
  archivedAt: string | null;
  brands: AccessAuditBrand[];
  cases: AccessAuditCase[];
  /** Overall verdict: are they actually usable right now? */
  status: 'active' | 'invited_not_logged_in' | 'awaiting_parent_approval'
        | 'no_password_and_no_link' | 'revoked_everywhere' | 'archived';
  /** What val should do about it. */
  nextAction: string;
}

interface UserRow extends RowDataPacket {
  client_user_id: number;
  email: string;
  display_name: string | null;
  client_id: number | null;
  tier: string | null;
  password_hash: string | null;
  magic_token: string | null;
  magic_token_expires_at: string | null;
  last_login_at: string | null;
  archived_at: string | null;
  primary_client_name: string | null;
}

interface BrandRow extends RowDataPacket {
  client_user_id: number;
  client_id: number;
  client_name: string;
  rel: 'owner' | 'member';
}

interface CaseRow extends RowDataPacket {
  client_user_id: number;
  case_id: number;
  case_name: string;
  case_client_id: number | null;
  role: string;
  invitation_accepted: 0 | 1;
  parent_approved: 0 | 1;
  revoked_at: string | null;
}

export async function loadAccessAudit(): Promise<AccessAuditUser[]> {
  const db = getAvDb();

  const [userRows] = await db.query<UserRow[]>(
    `SELECT
       cu.client_user_id, cu.email, cu.display_name, cu.client_id,
       cu.tier, cu.password_hash, cu.magic_token, cu.magic_token_expires_at,
       cu.last_login_at, cu.archived_at,
       c.client_name AS primary_client_name
     FROM client_users cu
     LEFT JOIN clients c ON c.client_id = cu.client_id
     ORDER BY cu.archived_at IS NULL DESC, cu.last_login_at DESC, cu.client_user_id DESC`
  );

  if (userRows.length === 0) return [];

  // Brand memberships — owner relationship via client_users.client_id is
  // already captured above; this pulls additional brand_members joins.
  const [brandRows] = await db.query<BrandRow[]>(
    `SELECT
       bm.client_user_id,
       bm.client_id,
       c.client_name,
       'member' AS rel
     FROM brand_members bm
     JOIN clients c ON c.client_id = bm.client_id
     WHERE bm.revoked_at IS NULL`
  );

  // Case collaborator rows — joined to cases for the name + brand.
  const [caseRows] = await db.query<CaseRow[]>(
    `SELECT
       fcc.client_user_id,
       fcc.case_id,
       c.case_name,
       c.client_id AS case_client_id,
       fcc.role,
       fcc.invitation_accepted,
       fcc.parent_approved,
       fcc.revoked_at
     FROM family_case_collaborators fcc
     JOIN cases c ON c.case_id = fcc.case_id`
  );

  const brandsByUser = new Map<number, AccessAuditBrand[]>();
  for (const u of userRows) {
    const arr: AccessAuditBrand[] = [];
    if (u.client_id && u.primary_client_name) {
      arr.push({ clientId: u.client_id, clientName: u.primary_client_name, rel: 'owner' });
    }
    brandsByUser.set(u.client_user_id, arr);
  }
  for (const b of brandRows) {
    const arr = brandsByUser.get(b.client_user_id);
    if (!arr) continue;
    if (arr.some((x) => x.clientId === b.client_id)) continue;
    arr.push({ clientId: b.client_id, clientName: b.client_name, rel: 'member' });
  }

  const casesByUser = new Map<number, AccessAuditCase[]>();
  for (const c of caseRows) {
    const reason = blockReason(c);
    const entry: AccessAuditCase = {
      caseId: c.case_id,
      caseName: c.case_name,
      caseClientId: c.case_client_id,
      role: c.role,
      invitationAccepted: c.invitation_accepted === 1,
      parentApproved: c.parent_approved === 1,
      revokedAt: c.revoked_at,
      canReach: reason === null,
      blockedReason: reason
    };
    const arr = casesByUser.get(c.client_user_id);
    if (arr) arr.push(entry);
    else casesByUser.set(c.client_user_id, [entry]);
  }

  return userRows.map((u) => {
    const brands = brandsByUser.get(u.client_user_id) ?? [];
    const cases = casesByUser.get(u.client_user_id) ?? [];
    const passwordSet = !!u.password_hash;
    const linkLive = !!u.magic_token
      && (!u.magic_token_expires_at || new Date(u.magic_token_expires_at) > new Date());

    let status: AccessAuditUser['status'];
    let nextAction: string;
    if (u.archived_at) {
      status = 'archived';
      nextAction = 'Archived — restore from client_users if needed.';
    } else if (cases.length > 0 && cases.every((c) => c.revokedAt)) {
      status = 'revoked_everywhere';
      nextAction = 'Every case access revoked. Re-invite if this was a mistake.';
    } else if (cases.length > 0 && cases.some((c) => !c.revokedAt && !c.parentApproved)) {
      status = 'awaiting_parent_approval';
      nextAction = 'Click "Mark approved" on the Family + Advisors panel — this is the silent blocker.';
    } else if (!passwordSet && !linkLive) {
      status = 'no_password_and_no_link';
      nextAction = 'Click "Reset password" on their row, or generate a fresh magic link.';
    } else if (!u.last_login_at) {
      status = 'invited_not_logged_in';
      nextAction = passwordSet
        ? 'They have a password but haven’t signed in yet. Resend the credentials.'
        : 'Send them the magic link — it bypasses the password.';
    } else {
      status = 'active';
      nextAction = 'No action needed.';
    }

    return {
      clientUserId: u.client_user_id,
      email: u.email,
      displayName: u.display_name,
      primaryClientId: u.client_id,
      primaryClientName: u.primary_client_name,
      tier: u.tier,
      passwordSet,
      magicToken: u.magic_token,
      magicTokenExpiresAt: u.magic_token_expires_at,
      lastLoginAt: u.last_login_at,
      archivedAt: u.archived_at,
      brands,
      cases,
      status,
      nextAction
    };
  });
}

function blockReason(c: CaseRow): string | null {
  if (c.revoked_at) return 'Revoked.';
  if (c.parent_approved !== 1) return 'parent_approved=FALSE — collaborator row is created but blocked at canClientUserAccessCase. Mark them approved to unblock.';
  // Invitation-accepted isn't a hard block (they can still access via magic
  // link), so we don't flag it here.
  return null;
}
