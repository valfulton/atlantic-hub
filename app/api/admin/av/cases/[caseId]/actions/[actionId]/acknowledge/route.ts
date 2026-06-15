/**
 * POST /api/admin/av/cases/[caseId]/actions/[actionId]/acknowledge
 *   (val 2026-06-15, #694)
 *
 * Family-side "Got it" toggle on an action item.
 *
 * Auth: client_user with case access (canClientUserAccessCase covers
 * brand-owner + case_collaborators + sibling_admin paths). Operator
 * (role='owner' or 'staff') can also POST — used by val's "View AS"
 * mode for testing the surface.
 *
 * Idempotent toggle: tapping a second time CLEARS the acknowledgment.
 * Returns { acknowledged: true|false } so the client can flip its
 * local optimistic UI immediately.
 *
 * Does NOT change status / completed_at — acknowledgment is a separate
 * "I've seen this and understand what's being done" signal, not a
 * "this is finished" claim.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import {
  toggleFamilyAcknowledge,
  getCase,
  canClientUserAccessCase
} from '@/lib/case/case_store';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { caseId: string; actionId: string };
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_action_ack:${ctx.params.actionId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  const caseId = parseInt(ctx.params.caseId, 10);
  const actionId = parseInt(ctx.params.actionId, 10);
  if (!Number.isInteger(caseId) || caseId <= 0) {
    return NextResponse.json({ ok: false, error: 'bad case id' }, { status: 400 });
  }
  if (!Number.isInteger(actionId) || actionId <= 0) {
    return NextResponse.json({ ok: false, error: 'bad action id' }, { status: 400 });
  }

  // Case must exist.
  const existing = await getCase(caseId);
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'case not found' }, { status: 404 });
  }

  // Resolve the acknowledging user id. For client_user, also gate on case
  // access. For operator (owner/staff), record val's own userId — useful
  // when val taps Got it during "View AS" testing.
  let actingUserId: number | null = guard.actor.userId ?? null;
  if (guard.actor.role === 'client_user') {
    const user = await findClientUserById(guard.actor.userId);
    if (!user) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }
    const primaryClientId = await activeBrandFor(guard.actor.userId, user.client_id ?? null);
    const allowed = await canClientUserAccessCase(
      guard.actor.userId, primaryClientId ?? 0, caseId
    );
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }
    actingUserId = guard.actor.userId;
  }

  if (actingUserId == null) {
    return NextResponse.json({ ok: false, error: 'no acting user' }, { status: 401 });
  }

  const result = await toggleFamilyAcknowledge(actionId, actingUserId);
  if (!result) {
    return NextResponse.json({ ok: false, error: 'toggle failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, acknowledged: result.acknowledged });
}
