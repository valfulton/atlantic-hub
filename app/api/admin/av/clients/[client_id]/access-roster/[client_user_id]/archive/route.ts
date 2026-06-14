/**
 * POST /api/admin/av/clients/[client_id]/access-roster/[client_user_id]/archive
 *
 * Archive a client_user — kills the login entirely. The row stays in the DB
 * (for audit/historical reasons) but archived_at gets stamped, the magic_token
 * is cleared, and the user is filtered out of every login query.
 *
 * This is the "they should not have any portal access" hammer. It's distinct
 * from case-collaborator revoke (which only scopes off one case while leaving
 * the portal login intact).
 *
 * Operator-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { archiveClientUser } from '@/lib/av/access_roster';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { client_id: string; client_user_id: string };
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `access_roster_archive:${ctx.params.client_user_id}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const clientUserId = parseInt(ctx.params.client_user_id, 10);
  if (!Number.isFinite(clientUserId) || clientUserId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }

  const result = await archiveClientUser(clientUserId);
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
