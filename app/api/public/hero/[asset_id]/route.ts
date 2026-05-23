/**
 * GET /api/public/hero/[asset_id]
 *
 * PUBLIC (no auth) serve route for a blog post's hero media. Intentionally not
 * in the middleware matcher. To prevent it from exposing arbitrary generated
 * assets, it serves bytes ONLY when the asset is the designated hero of an
 * approved or published content_artifact -- i.e. the operator deliberately made
 * it public by attaching it to a post that's gone live.
 *
 * Serves the durable bytes (lib/storage/provenance.getAssetBytes), so it never
 * 404s on an expired provider URL.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { getAssetBytes } from '@/lib/storage/provenance';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: { asset_id: string } }) {
  const assetId = Number.parseInt(params.asset_id, 10);
  if (!Number.isFinite(assetId) || assetId <= 0) {
    return NextResponse.json({ error: 'invalid asset_id' }, { status: 400 });
  }

  try {
    const db = getAvDb();
    // Gate: only assets attached as a hero to an approved/published post are public.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM content_artifacts
        WHERE status IN ('approved','published')
          AND CAST(JSON_EXTRACT(meta_json, '$.hero_asset_id') AS UNSIGNED) = ?
        LIMIT 1`,
      [assetId]
    );
    if (rows.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const got = await getAssetBytes(assetId);
    if (!got) return NextResponse.json({ error: 'asset unavailable' }, { status: 404 });

    return new NextResponse(got.bytes, {
      status: 200,
      headers: {
        'Content-Type': got.contentType,
        'Content-Length': String(got.bytes.byteLength),
        'Cache-Control': 'public, max-age=86400'
      }
    });
  } catch (err) {
    console.error('[public:hero]', (err as Error).message);
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
