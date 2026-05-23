/**
 * Video logo-branding (Phase 2).
 *
 * POST -> render the brand-kit logo onto the commercial video with ffmpeg, store
 *         the result in Netlify Blobs, mark the asset branded_status='ready'.
 *         Synchronous: commercials are short (1-15s) so one overlay pass fits in
 *         the function budget. (If long clips time out, move this to a background
 *         function -- the lib is reusable.)
 * GET  -> stream the stored branded video.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { getBrandKitForLead, getBrandKitLogoBuffer } from '@/lib/brand_kit/store';
import { composeBrandedVideo } from '@/lib/brand_kit/video_compositor';
import { putBrandedVideo, getBrandedVideo, brandedVideoKey } from '@/lib/storage/branded_blobs';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AssetRow extends RowDataPacket {
  id: number;
  lead_id: number;
  asset_type: 'image' | 'video';
  storage_url: string | null;
  generation_status: string;
  branded_status: string | null;
  branded_storage_key: string | null;
  lead_audit_id: string;
}

async function loadAsset(auditId: string, assetId: number): Promise<AssetRow | null> {
  const db = getAvDb();
  const [rows] = await db.execute<AssetRow[]>(
    `SELECT a.id, a.lead_id, a.asset_type, a.storage_url, a.generation_status,
            a.branded_status, a.branded_storage_key, l.audit_id AS lead_audit_id
       FROM grok_imagine_assets a
       INNER JOIN leads l ON l.id = a.lead_id
      WHERE a.id = ? LIMIT 1`,
    [assetId]
  );
  const a = rows[0];
  if (!a || a.lead_audit_id !== auditId) return null;
  return a;
}

export async function POST(req: NextRequest, { params }: { params: { audit_id: string; asset_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/leads/[audit_id]/commercial/[asset_id]/brand-video:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_av_enabled'))) return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  if (!UUID_RE.test(params.audit_id)) return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });
  const assetId = Number.parseInt(params.asset_id, 10);
  if (!Number.isFinite(assetId) || assetId <= 0) return NextResponse.json({ error: 'invalid asset_id' }, { status: 400 });

  const asset = await loadAsset(params.audit_id, assetId);
  if (!asset) return NextResponse.json({ error: 'asset not found' }, { status: 404 });
  if (asset.asset_type !== 'video') return NextResponse.json({ error: 'asset is not a video' }, { status: 400 });
  if (asset.generation_status !== 'succeeded' || !asset.storage_url) {
    return NextResponse.json({ error: `video not ready (status=${asset.generation_status})` }, { status: 409 });
  }

  const kit = await getBrandKitForLead(asset.lead_id);
  if (!kit || !kit.hasLogo) return NextResponse.json({ error: 'no brand kit / logo for this lead' }, { status: 404 });
  const logo = await getBrandKitLogoBuffer(asset.lead_id);
  if (!logo) return NextResponse.json({ error: 'logo bytes missing' }, { status: 404 });

  const db = getAvDb();
  await db.execute<ResultSetHeader>(`UPDATE grok_imagine_assets SET branded_status = 'processing', branded_error = NULL WHERE id = ?`, [assetId]);

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
    await logEvent({ eventType: 'commercial.video_branded', leadId: asset.lead_id, userId: guard.actor.userId, source: 'brand_kit', status: 'success', payload: { asset_id: assetId, duration_ms: result.durationMs } });

    const brandedUrl = `/api/admin/av/leads/${params.audit_id}/commercial/${assetId}/brand-video`;
    return NextResponse.json({ ok: true, brandedUrl, durationMs: result.durationMs });
  } catch (err) {
    const msg = (err as Error).message.slice(0, 480);
    await db.execute<ResultSetHeader>(`UPDATE grok_imagine_assets SET branded_status = 'failed', branded_error = ? WHERE id = ?`, [msg, assetId]).catch(() => {});
    await logEvent({ eventType: 'commercial.video_brand_failed', leadId: asset.lead_id, source: 'brand_kit', status: 'failure', errorMessage: msg, payload: { asset_id: assetId } });
    console.error('[brand-video]', msg);
    return NextResponse.json({ error: `video branding failed: ${msg}` }, { status: 502 });
  }
}

export async function GET(req: NextRequest, { params }: { params: { audit_id: string; asset_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/leads/[audit_id]/commercial/[asset_id]/brand-video:GET', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const assetId = Number.parseInt(params.asset_id, 10);
  if (!Number.isFinite(assetId) || assetId <= 0) return NextResponse.json({ error: 'invalid asset_id' }, { status: 400 });

  const asset = await loadAsset(params.audit_id, assetId);
  if (!asset || !asset.branded_storage_key || asset.branded_status !== 'ready') {
    return NextResponse.json({ error: 'no branded video for this asset yet' }, { status: 404 });
  }
  const bytes = await getBrandedVideo(asset.branded_storage_key);
  if (!bytes) return NextResponse.json({ error: 'branded video missing from store' }, { status: 404 });
  return new NextResponse(bytes, {
    status: 200,
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.byteLength), 'Cache-Control': 'private, max-age=300' }
  });
}
