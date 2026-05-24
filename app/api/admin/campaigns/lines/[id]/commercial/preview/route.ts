/**
 * POST /api/admin/campaigns/lines/[id]/commercial/preview
 *
 * Build (but do NOT generate) a commercial prompt from a narrative line. The
 * line's intelligence + a voiceover + imagery direction auto-populate it; the
 * operator edits the returned text before anything is ever generated. No model
 * call, no cost. Owner + staff only.
 *
 * Body: { assetType: 'image'|'video', durationSeconds?, logoSpace? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { buildLineCommercialPrompt, type AssetType, type LogoSpace } from '@/lib/grok/discoverer';

export const runtime = 'nodejs';

const LOGO_SPACES: LogoSpace[] = ['none', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/lines/commercial/preview:POST', tenantId: 'av' });
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
  const durationSeconds = typeof body.durationSeconds === 'number' ? body.durationSeconds : undefined;
  const logoSpace = typeof body.logoSpace === 'string' && LOGO_SPACES.includes(body.logoSpace as LogoSpace)
    ? (body.logoSpace as LogoSpace) : 'none';

  try {
    const result = await buildLineCommercialPrompt(lineId, { assetType, durationSeconds, logoSpace });
    if (!result) return NextResponse.json({ error: 'line not found' }, { status: 404 });
    return NextResponse.json({ ok: true, ...result, assetType });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
