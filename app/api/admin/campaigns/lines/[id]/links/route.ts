/**
 * /api/admin/campaigns/lines/[id]/links
 *
 * The narrative line's story map (schema 050 / lib/campaigns/line_links.ts).
 *   GET    -> { links, counts } for this line.
 *   POST   -> link or re-role an asset: { assetType, assetId, role?, note? }
 *   DELETE -> unlink: { assetType, assetId }
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getLane } from '@/lib/campaigns/store';
import {
  linkAssetToLine,
  unlinkAssetFromLine,
  listLinksForLine,
  roleCountsForLine,
  LINK_ROLES,
  type LinkAssetType,
  type LinkRole
} from '@/lib/campaigns/line_links';

export const runtime = 'nodejs';

const ASSET_TYPES: LinkAssetType[] = ['content_artifact', 'commercial', 'social_post', 'pr_pitch', 'press_release', 'lead', 'campaign'];

function parseLineId(id: string): number {
  const n = Number.parseInt(id, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/lines/links:GET', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const lineId = parseLineId(params.id);
  if (!lineId) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });

  const [links, counts] = await Promise.all([listLinksForLine(lineId), roleCountsForLine(lineId)]);
  return NextResponse.json({ ok: true, links, counts });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/lines/links:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const lineId = parseLineId(params.id);
  if (!lineId) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const assetType = body.assetType as LinkAssetType;
  const assetId = Number.parseInt(String(body.assetId ?? ''), 10);
  if (!ASSET_TYPES.includes(assetType)) return NextResponse.json({ error: 'invalid assetType' }, { status: 400 });
  if (!Number.isFinite(assetId) || assetId <= 0) return NextResponse.json({ error: 'invalid assetId' }, { status: 400 });
  const role = (LINK_ROLES as string[]).includes(String(body.role)) ? (body.role as LinkRole) : 'advances';
  const note = typeof body.note === 'string' ? body.note.slice(0, 280) : null;

  // The line must exist (and gives us the tenant for the link row).
  const line = await getLane(lineId);
  if (!line) return NextResponse.json({ error: 'line not found' }, { status: 404 });

  const ok = await linkAssetToLine({
    tenantId: line.tenantId,
    narrativeLineId: lineId,
    assetType,
    assetId,
    role,
    note
  });
  if (!ok) return NextResponse.json({ error: 'could not link' }, { status: 500 });
  const counts = await roleCountsForLine(lineId);
  return NextResponse.json({ ok: true, counts });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/lines/links:DELETE', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const lineId = parseLineId(params.id);
  if (!lineId) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const assetType = body.assetType as LinkAssetType;
  const assetId = Number.parseInt(String(body.assetId ?? ''), 10);
  if (!ASSET_TYPES.includes(assetType) || !Number.isFinite(assetId) || assetId <= 0) {
    return NextResponse.json({ error: 'invalid asset' }, { status: 400 });
  }

  await unlinkAssetFromLine(lineId, assetType, assetId);
  const counts = await roleCountsForLine(lineId);
  return NextResponse.json({ ok: true, counts });
}
