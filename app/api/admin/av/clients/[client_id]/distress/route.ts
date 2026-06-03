/**
 * GET  /api/admin/av/clients/[client_id]/distress           — current watchlist
 * POST /api/admin/av/clients/[client_id]/distress/rescore   — kick a rescore
 *
 * (#372) Revenue Distress Intelligence Engine surface.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { watchlistForClient } from '@/lib/public_intel/distress_engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/distress:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }
  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '25', 10) || 25));
  const rows = await watchlistForClient(clientId, limit);
  return NextResponse.json({ ok: true, count: rows.length, rows });
}
