/**
 * POST /api/admin/pr/artifacts/[id]/hero
 *
 * Attach (or clear) a HERO media for a blog/SEO/own-brand artifact. The hero
 * renders at the top of the post + as the /blog and newsroom card image.
 *
 * Body (one of):
 *   { heroAssetId: number, heroType: 'image'|'video' }  // use a generated commercial
 *   { heroUrl: string, heroType: 'image'|'video' }       // a public URL you paste
 *   { clear: true }                                       // remove the hero
 *
 * Stored in content_artifacts.meta_json (hero_asset_id | hero_url + hero_type),
 * so no schema change. A commercial asset hero is served publicly via
 * /api/public/hero/[asset_id] once the post is approved/published.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

interface ArtifactRow extends RowDataPacket {
  id: number;
  meta_json: unknown;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/artifacts/[id]/hero:POST', tenantId: 'av' });
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

  const clear = body.clear === true;
  const heroType = body.heroType === 'video' ? 'video' : body.heroType === 'image' ? 'image' : null;
  const heroAssetId =
    typeof body.heroAssetId === 'number' && Number.isFinite(body.heroAssetId) ? body.heroAssetId : null;
  const heroUrl = typeof body.heroUrl === 'string' && body.heroUrl.trim() ? body.heroUrl.trim().slice(0, 1024) : null;

  if (!clear) {
    if (!heroType) return NextResponse.json({ error: 'heroType (image|video) required' }, { status: 400 });
    if (heroAssetId == null && !heroUrl) {
      return NextResponse.json({ error: 'provide heroAssetId or heroUrl' }, { status: 400 });
    }
  }

  try {
    const db = getAvDb();
    const [rows] = await db.execute<ArtifactRow[]>(
      `SELECT id, meta_json FROM content_artifacts WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!rows[0]) return NextResponse.json({ error: 'not found' }, { status: 404 });

    let meta: Record<string, unknown> = {};
    if (rows[0].meta_json != null) {
      try {
        meta = (typeof rows[0].meta_json === 'string' ? JSON.parse(rows[0].meta_json) : rows[0].meta_json) as Record<string, unknown>;
      } catch {
        meta = {};
      }
    }

    if (clear) {
      delete meta.hero_asset_id;
      delete meta.hero_url;
      delete meta.hero_type;
    } else {
      meta.hero_type = heroType;
      if (heroAssetId != null) {
        meta.hero_asset_id = heroAssetId;
        delete meta.hero_url;
      } else {
        meta.hero_url = heroUrl;
        delete meta.hero_asset_id;
      }
    }

    await db.execute<ResultSetHeader>(
      `UPDATE content_artifacts SET meta_json = CAST(? AS JSON), updated_at = NOW() WHERE id = ?`,
      [JSON.stringify(meta), id]
    );

    return NextResponse.json({ ok: true, hero: clear ? null : { type: heroType, assetId: heroAssetId, url: heroUrl } });
  } catch (err) {
    console.error('[pr:artifact:hero]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
