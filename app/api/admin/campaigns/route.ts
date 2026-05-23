/**
 * /api/admin/campaigns
 *
 * GET  -> list campaigns (with lane + artifact counts) for a tenant.
 * POST -> create a campaign { name, laneId?, leadId?, goal?, tenant? }.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { listCampaigns, createCampaign, listCampaignsForLead } from '@/lib/campaigns/store';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns:GET', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const url = new URL(req.url);
  const leadIdParam = url.searchParams.get('leadId');
  try {
    // Lead-side view: which campaigns this lead is a target of.
    if (leadIdParam) {
      const leadId = Number.parseInt(leadIdParam, 10);
      if (!Number.isFinite(leadId) || leadId <= 0) return NextResponse.json({ error: 'invalid leadId' }, { status: 400 });
      return NextResponse.json({ ok: true, campaigns: await listCampaignsForLead(leadId) });
    }
    const campaigns = await listCampaigns(url.searchParams.get('tenant') || 'av');
    return NextResponse.json({ ok: true, campaigns });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  try {
    const id = await createCampaign({
      tenantId: typeof body.tenant === 'string' ? body.tenant : 'av',
      laneId: typeof body.laneId === 'number' ? body.laneId : null,
      leadId: typeof body.leadId === 'number' ? body.leadId : null,
      name,
      goal: typeof body.goal === 'string' ? body.goal : null,
      userId: guard.actor.userId
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
