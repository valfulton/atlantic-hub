/**
 * GET /api/admin/av/clients/[client_id]/intel-feed  (#380, val 2026-06-03)
 *
 * Unified chronological intelligence feed — every adapter record + every
 * scored entity + every worker run for this client. The "information
 * everywhere" surface.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { intelligenceFeedForClient } from '@/lib/public_intel/feed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/intel-feed:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }
  const limit = Math.min(200, Math.max(10, parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10) || 50));
  const events = await intelligenceFeedForClient(clientId, limit);
  return NextResponse.json({ ok: true, events });
}
