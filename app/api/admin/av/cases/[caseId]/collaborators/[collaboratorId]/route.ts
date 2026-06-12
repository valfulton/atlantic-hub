/**
 * Per-collaborator actions on a case.
 *   PATCH  approve (parent_approved = TRUE) — used when a parent says yes
 *   DELETE revoke (soft-delete via revoked_at)
 *
 * Operator-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { approveCollaborator, revokeCollaborator } from '@/lib/case/case_collaborators';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { caseId: string; collaboratorId: string };
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_collaborator_approve:${ctx.params.collaboratorId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const collaboratorId = parseInt(ctx.params.collaboratorId, 10);
  if (!Number.isInteger(collaboratorId) || collaboratorId <= 0) {
    return NextResponse.json({ ok: false, error: 'bad collaborator id' }, { status: 400 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'body must be json' }, { status: 400 }); }
  const b = (body && typeof body === 'object') ? body as Record<string, unknown> : {};

  // Only action right now is approve. Body lets us extend later.
  if (b.action === 'approve' || Object.keys(b).length === 0) {
    const ok = await approveCollaborator(collaboratorId, guard.actor.userId);
    if (!ok) {
      return NextResponse.json({ ok: false, error: 'approve failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_collaborator_revoke:${ctx.params.collaboratorId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const collaboratorId = parseInt(ctx.params.collaboratorId, 10);
  if (!Number.isInteger(collaboratorId) || collaboratorId <= 0) {
    return NextResponse.json({ ok: false, error: 'bad collaborator id' }, { status: 400 });
  }
  const ok = await revokeCollaborator(collaboratorId);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'revoke failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
