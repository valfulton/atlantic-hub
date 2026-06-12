/**
 * Collaborators for a case.
 *   GET   list all collaborators (with parent-approval status + magic link)
 *   POST  invite a new collaborator (creates client_user if needed)
 *
 * Operator-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import {
  listCollaboratorsForCase,
  inviteCollaborator,
  DEFAULT_PERMISSIONS_BY_ROLE,
  type CollaboratorRole
} from '@/lib/case/case_collaborators';
import { getCase } from '@/lib/case/case_store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { caseId: string };
}

const VALID_ROLES = Object.keys(DEFAULT_PERMISSIONS_BY_ROLE) as CollaboratorRole[];

export async function GET(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_collaborators_list:${ctx.params.caseId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  const caseId = parseInt(ctx.params.caseId, 10);
  if (!Number.isInteger(caseId) || caseId <= 0) {
    return NextResponse.json({ ok: false, error: 'bad case id' }, { status: 400 });
  }
  const collaborators = await listCollaboratorsForCase(caseId);
  return NextResponse.json({ ok: true, collaborators });
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_collaborators_invite:${ctx.params.caseId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    // Phase 4 will open this to sibling_admin clients via a scoped route;
    // for now operators do all invites so the parent-approval gate is honored.
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const caseId = parseInt(ctx.params.caseId, 10);
  if (!Number.isInteger(caseId) || caseId <= 0) {
    return NextResponse.json({ ok: false, error: 'bad case id' }, { status: 400 });
  }
  const existing = await getCase(caseId);
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'case not found' }, { status: 404 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'body must be json' }, { status: 400 }); }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'body required' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const email = typeof b.email === 'string' ? b.email.trim() : '';
  const displayName = typeof b.displayName === 'string' && b.displayName.trim() ? b.displayName.trim() : null;
  const role = typeof b.role === 'string' ? (b.role as CollaboratorRole) : 'sibling_reader';

  if (!email) {
    return NextResponse.json({ ok: false, error: 'email required' }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ ok: false, error: `invalid role (valid: ${VALID_ROLES.join(', ')})` }, { status: 400 });
  }

  // Operator can flag bypassParentApproval=true when val knows a parent has
  // verbally said yes. Default FALSE — invite sits pending until a parent
  // approves it via the approve endpoint or via the future parent-portal.
  const bypassParentApproval = b.bypassParentApproval === true;

  const result = await inviteCollaborator({
    caseId,
    clientId: existing.clientId,
    inviterUserId: guard.actor.userId,
    email,
    displayName,
    role,
    bypassParentApproval
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error || 'invite failed' }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    collaboratorId: result.collaboratorId,
    clientUserId: result.clientUserId,
    magicLink: result.magicLink,
    pendingParentApproval: !bypassParentApproval
  });
}
