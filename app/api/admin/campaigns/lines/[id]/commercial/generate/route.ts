/**
 * POST /api/admin/campaigns/lines/[id]/commercial/generate
 *
 * Generate a commercial FROM A NARRATIVE LINE (no lead). Uses the operator's
 * EDITED prompt (sent in the body). Image is synchronous; video starts async
 * and returns 'running' (the GET-asset endpoint finishes the poll). The asset
 * is tagged with narrative_line_id and has no lead_id. Owner + staff only.
 *
 * Body: { assetType: 'image'|'video', prompt: string, durationSeconds? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { generateLineCommercial, type AssetType } from '@/lib/grok/discoverer';
import { getLane } from '@/lib/campaigns/store';
import { linkAssetToLine } from '@/lib/campaigns/line_links';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/lines/commercial/generate:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const lineId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(lineId) || lineId <= 0) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const assetType: AssetType = body.assetType === 'video' ? 'video' : 'image';
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return NextResponse.json({ error: 'a prompt is required — draft and edit one first' }, { status: 400 });
  const durationSeconds = typeof body.durationSeconds === 'number' ? body.durationSeconds : undefined;

  try {
    const result = await generateLineCommercial(lineId, {
      assetType,
      customPrompt: prompt,
      durationSeconds,
      actorUserId: guard.actor.userId,
      awaitCompletion: false // video returns 'running'; image is sync regardless
    });

    // Narrative spine (schema 050): a line-born commercial ADVANCES that line's
    // story. Non-fatal — never let a link failure break generation.
    if (result?.assetId) {
      try {
        const line = await getLane(lineId);
        await linkAssetToLine({
          tenantId: line?.tenantId ?? 'av',
          narrativeLineId: lineId,
          assetType: 'commercial',
          assetId: result.assetId,
          role: 'advances',
          createdByUserId: guard.actor.userId
        });
      } catch {
        /* non-fatal */
      }
    }

    return NextResponse.json({ ok: true, asset: result });
  } catch (err) {
    return NextResponse.json({ error: 'generation failed', detail: (err as Error).message, errorClass: (err as Error).name }, { status: 500 });
  }
}
