/**
 * Per-target operator actions (#45, val 2026-06-02)
 *
 *   POST   /api/admin/av/clients/[client_id]/social/[target_id]
 *      body { action: 'confirm' | 'reject' }
 *
 *   DELETE /api/admin/av/clients/[client_id]/social/[target_id]
 *      remove the target outright (mistake / wrong URL)
 *
 * Operator-only. Verifies the target belongs to the named client before
 * touching it -- so a stale target_id can't be hijacked across brands.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { confirmTarget, rejectTarget, deleteTarget, getTargetById } from '@/lib/social/targets';

export const runtime = 'nodejs';

async function authorize(req: NextRequest, clientIdStr: string, targetIdStr: string) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/social/target:WRITE',
    tenantId: 'av'
  });
  if (!guard.ok) return { ok: false as const, response: guard.response };
  if (guard.actor.role === 'client_user') {
    return { ok: false as const, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  const clientId = Number.parseInt(clientIdStr, 10);
  const targetId = Number.parseInt(targetIdStr, 10);
  if (!Number.isFinite(clientId) || clientId <= 0 || !Number.isFinite(targetId) || targetId <= 0) {
    return { ok: false as const, response: NextResponse.json({ error: 'invalid id' }, { status: 400 }) };
  }
  const target = await getTargetById(targetId);
  if (!target) return { ok: false as const, response: NextResponse.json({ error: 'not found' }, { status: 404 }) };
  if (target.clientId !== clientId) {
    return { ok: false as const, response: NextResponse.json({ error: 'wrong brand' }, { status: 403 }) };
  }
  return { ok: true as const, target, clientId, targetId };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { client_id: string; target_id: string } }
) {
  const a = await authorize(req, params.client_id, params.target_id);
  if (!a.ok) return a.response;

  let body: { action?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const action = body.action;
  if (action === 'confirm') {
    const updated = await confirmTarget(a.targetId);
    return NextResponse.json({ ok: true, target: updated });
  }
  if (action === 'reject') {
    const updated = await rejectTarget(a.targetId);
    return NextResponse.json({ ok: true, target: updated });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { client_id: string; target_id: string } }
) {
  const a = await authorize(req, params.client_id, params.target_id);
  if (!a.ok) return a.response;
  await deleteTarget(a.targetId);
  return NextResponse.json({ ok: true });
}
