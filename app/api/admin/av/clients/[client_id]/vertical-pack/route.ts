/**
 * GET  /api/admin/av/clients/[client_id]/vertical-pack         — list packs
 * POST /api/admin/av/clients/[client_id]/vertical-pack/apply   — apply pack
 *
 * (#376) Vertical Packs: the horizontal-platform pricing unlock.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { listPacks, applyVerticalPackToClient, type VerticalPackId } from '@/lib/public_intel/vertical_packs';
import { getBriefPayload, saveBriefPayload } from '@/lib/client/brief_store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/vertical-pack:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }
  // (#530c) Surface which pack is currently applied so the UI can show
  // "Applied" indicator + the apply timestamp.
  const brief = (await getBriefPayload('av', clientId)) as Record<string, unknown> | null;
  const appliedPackId = typeof brief?.vertical_pack_id === 'string' ? brief.vertical_pack_id : null;
  const appliedAt = typeof brief?.vertical_pack_applied_at === 'string' ? brief.vertical_pack_applied_at : null;

  return NextResponse.json({
    ok: true,
    appliedPackId,
    appliedAt,
    packs: listPacks().map((p) => ({
      id: p.id,
      displayName: p.displayName,
      shortPositioning: p.shortPositioning,
      bestForRoles: p.bestForRoles,
      pitchTemplate: p.pitchTemplate,
      pricingThesis: p.pricingThesis,
      suggestedPriceUsd: p.suggestedPriceUsd,
      recommendedAdapters: p.recommendedAdapters,
      cascadeRecipeIds: p.cascadeRecipeIds,
      signalCount: Object.keys(p.signalWeights).length
    }))
  });
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/vertical-pack:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }
  let body: { packId?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { /* empty fine */ }
  const packId = typeof body.packId === 'string' ? (body.packId as VerticalPackId) : null;
  if (!packId) return NextResponse.json({ error: 'packId required' }, { status: 400 });

  const result = await applyVerticalPackToClient(clientId, packId);

  // (#530c) Persist which pack is now applied so the UI can show "✓ Applied"
  // even after a page refresh. Stored in brief_payload (no schema migration).
  // saveBriefPayload does a full column replace, so we must pre-load + merge.
  try {
    const current = (await getBriefPayload('av', clientId)) as Record<string, unknown> | null;
    const merged = {
      ...(current ?? {}),
      vertical_pack_id: packId,
      vertical_pack_applied_at: new Date().toISOString()
    };
    await saveBriefPayload('av', clientId, merged);
  } catch (err) {
    console.error('[vertical-pack:persist]', (err as Error).message);
    // Don't fail the apply if brief save errored — the weights were still seeded.
  }

  return NextResponse.json(result);
}
