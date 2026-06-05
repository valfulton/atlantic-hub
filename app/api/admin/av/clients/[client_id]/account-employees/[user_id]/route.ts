/**
 * /api/admin/av/clients/[client_id]/account-employees/[user_id]  (#377)
 *
 * DELETE — unassign an AV employee from a client account. Their leads stay
 * with them (see unassignEmployee comment); release-leads is a separate
 * action via the existing ReleaseLeadsPanel.
 *
 * Owner/staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { unassignEmployee, listAccountEmployees } from '@/lib/av/account_employees';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { client_id: string; user_id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[id]/account-employees/[uid]:DELETE',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  const userId = Number.parseInt(params.user_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) return NextResponse.json({ error: 'bad client_id' }, { status: 400 });
  if (!Number.isFinite(userId) || userId <= 0) return NextResponse.json({ error: 'bad user_id' }, { status: 400 });

  const result = await unassignEmployee(clientId, userId);
  if (!result.ok) return NextResponse.json({ error: result.error ?? 'unassign failed' }, { status: 400 });

  const assigned = await listAccountEmployees(clientId);
  return NextResponse.json({ ok: true, deleted: result.deleted, assigned });
}
