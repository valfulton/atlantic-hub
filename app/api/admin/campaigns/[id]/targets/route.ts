/**
 * /api/admin/campaigns/[id]/targets
 *
 * GET    -> leads this campaign targets.
 * POST   -> attach leads: { leadIds: number[] } OR { painCategory, industry? }
 *           (the latter attaches every active lead sharing that pain).
 * DELETE -> detach a lead: { leadId }.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getCampaignTargets, attachLeads, attachLeadsByPain, detachLead } from '@/lib/campaigns/store';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/[id]/targets:GET', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, targets: await getCampaignTargets(id) });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/[id]/targets:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  try {
    if (typeof body.painCategory === 'string' && body.painCategory) {
      const added = await attachLeadsByPain(id, {
        painCategory: body.painCategory,
        industry: typeof body.industry === 'string' ? body.industry : null
      });
      return NextResponse.json({ ok: true, added });
    }
    if (Array.isArray(body.leadIds)) {
      const ids = (body.leadIds as unknown[]).map((n) => (typeof n === 'number' ? n : Number.parseInt(String(n), 10)));
      const added = await attachLeads(id, ids);
      return NextResponse.json({ ok: true, added });
    }
    return NextResponse.json({ error: 'provide leadIds or painCategory' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/[id]/targets:DELETE', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const leadId = typeof body.leadId === 'number' ? body.leadId : Number.parseInt(String(body.leadId), 10);
  if (!Number.isFinite(leadId) || leadId <= 0) return NextResponse.json({ error: 'leadId required' }, { status: 400 });
  try {
    await detachLead(id, leadId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
