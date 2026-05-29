/**
 * /api/admin/av/clients/[client_id]/pr-sources/[source_id]  (#214)
 *
 * Per-source actions: toggle active flag, delete.
 * PATCH body: { isActive?: boolean }
 * DELETE: hard delete.
 *
 * Both scope the WHERE by both source_id AND client_id so an operator
 * can never delete or toggle a source that belongs to a different client
 * by accident.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { setSourceActive, deleteSource } from '@/lib/pr/client_sources';

export const runtime = 'nodejs';

interface RouteParams { params: { client_id: string; source_id: string } }

function parseIds(p: RouteParams['params']): { clientId: number; sourceId: number } | null {
  const clientId = Number.parseInt(p.client_id, 10);
  const sourceId = Number.parseInt(p.source_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) return null;
  if (!Number.isFinite(sourceId) || sourceId <= 0) return null;
  return { clientId, sourceId };
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/pr-sources:PATCH',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_av_enabled'))) return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });

  const ids = parseIds(params);
  if (!ids) return NextResponse.json({ error: 'invalid_ids' }, { status: 400 });

  let body: { isActive?: unknown } = {};
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  if (typeof body.isActive !== 'boolean') {
    return NextResponse.json({ error: 'isActive_required' }, { status: 400 });
  }

  try {
    await setSourceActive(ids.sourceId, ids.clientId, body.isActive);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'update_failed', message: (err as Error).message.slice(0, 300) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/pr-sources:DELETE',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_av_enabled'))) return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });

  const ids = parseIds(params);
  if (!ids) return NextResponse.json({ error: 'invalid_ids' }, { status: 400 });

  try {
    await deleteSource(ids.sourceId, ids.clientId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'delete_failed', message: (err as Error).message.slice(0, 300) }, { status: 500 });
  }
}
