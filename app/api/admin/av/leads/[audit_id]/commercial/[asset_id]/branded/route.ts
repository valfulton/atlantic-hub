/**
 * GET /api/admin/av/leads/[audit_id]/commercial/[asset_id]/branded
 *
 * Streams a freshly-composited image: the raw asset URL with the lead's
 * brand-kit logo overlaid in the configured corner.
 *
 * Image only in Phase 1. Video composites land in Phase 2 (ffmpeg).
 * If the asset is a video, the route returns 501 with a clear message.
 *
 * Caching strategy v1: compose on every GET. Phase 2: cache to Netlify
 * Blobs / S3.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { getBrandKitForLead } from '@/lib/brand_kit/store';
import { composeBrandedImage } from '@/lib/brand_kit/compositor';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AssetJoinRow extends RowDataPacket {
  id: number;
  lead_id: number;
  asset_type: 'image' | 'video';
  storage_url: string | null;
  generation_status: 'queued' | 'running' | 'succeeded' | 'failed';
  lead_audit_id: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { audit_id: string; asset_id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/commercial/[asset_id]/branded',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }
  if (!UUID_RE.test(params.audit_id)) {
    return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });
  }
  const assetId = Number.parseInt(params.asset_id, 10);
  if (!Number.isFinite(assetId) || assetId <= 0) {
    return NextResponse.json({ error: 'invalid asset_id' }, { status: 400 });
  }

  const db = getAvDb();
  const [rows] = await db.execute<AssetJoinRow[]>(
    `SELECT a.id, a.lead_id, a.asset_type, a.storage_url, a.generation_status,
            l.audit_id AS lead_audit_id
     FROM grok_imagine_assets a
     INNER JOIN leads l ON l.id = a.lead_id
     WHERE a.id = ? LIMIT 1`,
    [assetId]
  );
  const asset = rows[0];
  if (!asset) return NextResponse.json({ error: 'asset not found' }, { status: 404 });
  if (asset.lead_audit_id !== params.audit_id) {
    return NextResponse.json({ error: 'asset not on this lead' }, { status: 404 });
  }
  if (asset.generation_status !== 'succeeded' || !asset.storage_url) {
    return NextResponse.json(
      { error: `asset not ready (status=${asset.generation_status})` },
      { status: 409 }
    );
  }
  if (asset.asset_type !== 'image') {
    return NextResponse.json(
      { error: 'video composite not implemented in Phase 1 -- ships in the logo-overlay video phase' },
      { status: 501 }
    );
  }

  const kit = await getBrandKitForLead(asset.lead_id);
  if (!kit || !kit.hasLogo) {
    return NextResponse.json(
      { error: 'no brand kit / logo configured for this lead' },
      { status: 404 }
    );
  }

  try {
    const result = await composeBrandedImage({ sourceUrl: asset.storage_url, kit });
    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Content-Length': String(result.buffer.length),
        // Short cache: settings can change. 60s is enough to avoid spamming
        // the compositor on a page that previews many cards at once.
        'Cache-Control': 'private, max-age=60',
        'X-Compose-Duration-Ms': String(result.durationMs)
      }
    });
  } catch (err) {
    console.error('[brand-kit:branded]', (err as Error).message);
    return NextResponse.json(
      {
        error: 'composite failed',
        detail: (err as Error).message.slice(0, 300),
        errorClass: (err as Error).name
      },
      { status: 500 }
    );
  }
}
