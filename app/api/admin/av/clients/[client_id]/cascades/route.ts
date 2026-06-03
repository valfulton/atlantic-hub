/**
 * GET  /api/admin/av/clients/[client_id]/cascades       — list recipes + status
 * POST /api/admin/av/clients/[client_id]/cascades/run   — sweep + fire cascades
 *
 * (#374) Cascade Pipeline — chained adapter runs that turn isolated hits
 * into stitched, enriched entity bundles.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { listRecipes, recipeStatus } from '@/lib/public_intel/cascade';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/cascades:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }
  const recipes = listRecipes().map((r) => ({
    id: r.id,
    displayName: r.displayName,
    description: r.description,
    bestFor: r.bestFor,
    requires: r.requires,
    status: recipeStatus(r)
  }));
  return NextResponse.json({ ok: true, recipes });
}
