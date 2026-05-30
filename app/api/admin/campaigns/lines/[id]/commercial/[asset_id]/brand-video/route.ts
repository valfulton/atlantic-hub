/**
 * /api/admin/campaigns/lines/[id]/commercial/[asset_id]/brand-video   (#61 Inc 1)
 *
 * Line-scoped mirror of the lead's brand-video endpoint. Line-born commercials
 * have lead_id=NULL + narrative_line_id set, so the lead-scoped route can't
 * touch them. Same composeBrandedVideo + branded_blobs storage as the lead
 * path — only the asset lookup + brand-kit resolution differ:
 *
 *   - Asset must belong to THIS line (narrative_line_id = path id) and have
 *     lead_id IS NULL (the line-born marker; lead-scoped commercials use the
 *     other route).
 *   - Brand kit resolves from the line's OWNER (client_id, or null for house
 *     lines) via getBrandKitForClient — picks the freshest kit among that
 *     customer's leads. Honest 404 with copy if there's nothing to pull from.
 *
 * POST renders + stores branded; GET streams it. Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { getLane } from '@/lib/campaigns/store';
import { getBrandKitForClient, getBrandKitLogoBufferForClient } from '@/lib/brand_kit/store';
import { composeBrandedVideo } from '@/lib/brand_kit/video_compositor';
import { putBrandedVideo, getBrandedVideo, brandedVideoKey } from '@/lib/storage/branded_blobs';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface LineAssetRow extends RowDataPacket {
  id: number;
  narrative_line_id: number | null;
  lead_id: number | null;
  asset_type: 'image' | 'video';
  storage_url: string | null;
  generation_status: string;
  branded_status: string | null;
  branded_storage_key: string | null;
}

async function loadAsset(lineId: number, assetId: number): Promise<LineAssetRow | null> {
  const db = getAvDb();
  const [rows] = await db.execute<LineAssetRow[]>(
    `SELECT id, narrative_line_id, lead_id, asset_type, storage_url, generation_status,
            branded_status, branded_storage_key
       FROM grok_imagine_assets
      WHERE id = ?
      LIMIT 1`,
    [assetId]
  );
  const a = rows[0];
  // The asset must be ON this line AND line-born (lead_id NULL). If it has a
  // lead, the lead-scoped route handles it — we refuse here to keep the two
  // paths from stepping on each other.
  if (!a || a.narrative_line_id !== lineId || a.lead_id !== null) return null;
  return a;
}

function parseLineId(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function POST(req: NextRequest, { params }: { params: { id: string; asset_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/campaigns/lines/[id]/commercial/[asset_id]/brand-video:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_av_enabled'))) return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });

  const lineId = parseLineId(params.id);
  if (!lineId) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });
  const assetId = Number.parseInt(params.asset_id, 10);
  if (!Number.isFinite(assetId) || assetId <= 0) return NextResponse.json({ error: 'invalid asset_id' }, { status: 400 });

  const line = await getLane(lineId);
  if (!line) return NextResponse.json({ error: 'line not found' }, { status: 404 });

  const asset = await loadAsset(lineId, assetId);
  if (!asset) return NextResponse.json({ error: 'asset not found on this line' }, { status: 404 });
  if (asset.asset_type !== 'video') return NextResponse.json({ error: 'asset is not a video' }, { status: 400 });
  if (asset.generation_status !== 'succeeded' || !asset.storage_url) {
    return NextResponse.json({ error: `video not ready (status=${asset.generation_status})` }, { status: 409 });
  }

  // Resolve the brand kit from the LINE's owner — not from any lead, because
  // there isn't one. Honest copy when the customer hasn't set one up yet.
  const kit = await getBrandKitForClient(line.clientId);
  if (!kit || !kit.hasLogo) {
    return NextResponse.json(
      { error: `no brand kit for ${line.clientId ? 'this client' : 'the house brand'} yet — set one up on any of their leads first.` },
      { status: 404 }
    );
  }
  const logo = await getBrandKitLogoBufferForClient(line.clientId);
  if (!logo) return NextResponse.json({ error: 'logo bytes missing' }, { status: 404 });

  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `UPDATE grok_imagine_assets SET branded_status = 'processing', branded_error = NULL WHERE id = ?`,
    [assetId]
  );

  try {
    const result = await composeBrandedVideo({
      videoUrl: asset.storage_url,
      logoBuffer: logo.buffer,
      logoMime: logo.mimeType,
      position: kit.defaultPosition,
      scale: Number(kit.defaultScale) || 0.18,
      opacity: Number(kit.defaultOpacity) || 1,
      paddingPx: Number(kit.defaultPadding) || 24
    });

    const key = brandedVideoKey(assetId);
    await putBrandedVideo(key, result.buffer);
    await db.execute<ResultSetHeader>(
      `UPDATE grok_imagine_assets SET branded_status = 'ready', branded_storage_key = ?, branded_at = NOW(), branded_error = NULL WHERE id = ?`,
      [key, assetId]
    );
    await logEvent({
      eventType: 'commercial.video_branded',
      leadId: null,
      userId: guard.actor.userId,
      source: 'brand_kit',
      status: 'success',
      payload: { asset_id: assetId, narrative_line_id: lineId, client_id: line.clientId, duration_ms: result.durationMs }
    });

    const brandedUrl = `/api/admin/campaigns/lines/${lineId}/commercial/${assetId}/brand-video`;
    return NextResponse.json({ ok: true, brandedUrl, durationMs: result.durationMs });
  } catch (err) {
    const msg = (err as Error).message.slice(0, 480);
    await db.execute<ResultSetHeader>(
      `UPDATE grok_imagine_assets SET branded_status = 'failed', branded_error = ? WHERE id = ?`,
      [msg, assetId]
    ).catch(() => {});
    await logEvent({
      eventType: 'commercial.video_brand_failed',
      leadId: null,
      source: 'brand_kit',
      status: 'failure',
      errorMessage: msg,
      payload: { asset_id: assetId, narrative_line_id: lineId, client_id: line.clientId }
    });
    console.error('[brand-video:line]', msg);
    return NextResponse.json({ error: `video branding failed: ${msg}` }, { status: 502 });
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string; asset_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/campaigns/lines/[id]/commercial/[asset_id]/brand-video:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const lineId = parseLineId(params.id);
  if (!lineId) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });
  const assetId = Number.parseInt(params.asset_id, 10);
  if (!Number.isFinite(assetId) || assetId <= 0) return NextResponse.json({ error: 'invalid asset_id' }, { status: 400 });

  const asset = await loadAsset(lineId, assetId);
  if (!asset || !asset.branded_storage_key || asset.branded_status !== 'ready') {
    return NextResponse.json({ error: 'no branded video for this asset yet' }, { status: 404 });
  }
  const bytes = await getBrandedVideo(asset.branded_storage_key);
  if (!bytes) return NextResponse.json({ error: 'branded video missing from store' }, { status: 404 });
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, max-age=300'
    }
  });
}
