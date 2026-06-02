/**
 * GET /api/admin/av/clients/[client_id]/social  (#45, val 2026-06-02)
 *
 * List social_targets for this brand. Operator + staff only. Used by the
 * SocialChannelsPanel to refresh after a confirm/reject without a full
 * page reload.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { listTargetsForBrand } from '@/lib/social/targets';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/social:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  const targets = await listTargetsForBrand(clientId);
  return NextResponse.json({ ok: true, targets });
}
