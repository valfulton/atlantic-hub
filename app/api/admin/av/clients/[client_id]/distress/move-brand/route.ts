/**
 * POST /api/admin/av/clients/[client_id]/distress/move-brand  (#386, val 2026-06-05)
 *
 * Operator-side companion to /api/client/distress/move-brand. Val (operator)
 * can move a watchlist entity from any brand to any other brand because she's
 * the platform admin — no brand_members owner check needed. The {client_id}
 * in the URL is treated as the SOURCE brand; toClientId comes from the body.
 *
 * Owner / staff only. Body: { toClientId: number, entityKey: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { moveDistressEntity } from '@/lib/public_intel/move_brand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/distress/move-brand:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const fromClientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(fromClientId) || fromClientId <= 0) {
    return NextResponse.json({ error: 'invalid source client id' }, { status: 400 });
  }

  let body: { toClientId?: unknown; entityKey?: unknown } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const toClientId = Number(body.toClientId);
  const entityKey = typeof body.entityKey === 'string' ? body.entityKey : '';
  if (!Number.isInteger(toClientId) || toClientId <= 0) {
    return NextResponse.json({ error: 'toClientId required' }, { status: 400 });
  }
  if (!entityKey) {
    return NextResponse.json({ error: 'entityKey required' }, { status: 400 });
  }

  const result = await moveDistressEntity({ fromClientId, toClientId, entityKey });
  if (!result.ok) {
    const status = result.reason === 'source_not_found' ? 404
      : result.reason === 'same_brand' ? 400
      : 500;
    return NextResponse.json({ ok: false, reason: result.reason, detail: result.detail }, { status });
  }
  return NextResponse.json({ ok: true, mode: result.mode, toClientId: result.toClientId });
}
