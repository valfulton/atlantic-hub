/**
 * GET /api/admin/campaigns/clusters
 *
 * Pain clusters available to target a campaign at: (industry, pain_category)
 * with the count of active leads in each. Powers the "attach by pain point"
 * picker. Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { listPainClusters } from '@/lib/campaigns/store';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/clusters:GET', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, clusters: await listPainClusters() });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
