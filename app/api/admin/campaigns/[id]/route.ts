/**
 * /api/admin/campaigns/[id]
 *
 * GET  -> the campaign + the blog/commercial content compiled into it.
 * POST -> assign/unassign content to this campaign:
 *           { artifactId: number, clear?: boolean }  -- a blog/SEO/own-brand piece
 *           { assetId: number, clear?: boolean }      -- a generated commercial
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getCampaignContent, assignArtifactToCampaign, assignAssetToCampaign } from '@/lib/campaigns/store';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/[id]:GET', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  try {
    const content = await getCampaignContent(id);
    if (!content) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ ok: true, ...content });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/[id]:POST', tenantId: 'av' });
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
  const target = body.clear === true ? null : id;
  const artifactId = typeof body.artifactId === 'number' ? body.artifactId : null;
  const assetId = typeof body.assetId === 'number' ? body.assetId : null;
  if (artifactId == null && assetId == null) {
    return NextResponse.json({ error: 'artifactId or assetId required' }, { status: 400 });
  }
  try {
    if (artifactId != null) await assignArtifactToCampaign(artifactId, target);
    if (assetId != null) await assignAssetToCampaign(assetId, target);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
