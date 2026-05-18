/**
 * GET    /api/admin/av/leads/[audit_id]/commercial/[asset_id]
 * DELETE /api/admin/av/leads/[audit_id]/commercial/[asset_id]
 *
 * Per-asset endpoint. Owner + staff for GET. Owner only for DELETE.
 *
 * GET behavior:
 *   - Returns the asset metadata + URL.
 *   - If the asset is a video in 'running' state, transparently re-polls the
 *     upstream xAI job (via resumeRunningVideoAsset) so the UI's first GET
 *     after the POST budget timeout has a chance to see the finished video.
 *
 * DELETE behavior:
 *   - Soft delete: sets archived_at = NOW(). Owner only.
 *   - Returns 204 No Content on success.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { resumeRunningVideoAsset } from '@/lib/grok/discoverer';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AssetRow extends RowDataPacket {
  id: number;
  lead_id: number;
  asset_type: 'image' | 'video';
  model: string;
  prompt: string;
  enhanced_prompt: string | null;
  provider_request_id: string | null;
  storage_url: string | null;
  cost_usd: string | number | null;
  generation_status: 'queued' | 'running' | 'succeeded' | 'failed';
  duration_seconds: string | number | null;
  resolution_tier: '1k' | '2k';
  aspect_ratio: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  archived_at: string | null;
  lead_audit_id: string;
}

async function resolveAsset(
  auditId: string,
  assetIdRaw: string
): Promise<{ asset: AssetRow | null; status: number; error?: string }> {
  if (!UUID_RE.test(auditId)) {
    return { asset: null, status: 400, error: 'invalid audit_id' };
  }
  const assetId = Number.parseInt(assetIdRaw, 10);
  if (!Number.isFinite(assetId) || assetId <= 0) {
    return { asset: null, status: 400, error: 'invalid asset_id' };
  }

  const db = getAvDb();
  const [rows] = await db.execute<AssetRow[]>(
    `SELECT a.id, a.lead_id, a.asset_type, a.model, a.prompt, a.enhanced_prompt,
            a.provider_request_id, a.storage_url, a.cost_usd, a.generation_status,
            a.duration_seconds, a.resolution_tier, a.aspect_ratio, a.error_message,
            a.created_at, a.completed_at, a.archived_at, l.audit_id AS lead_audit_id
     FROM grok_imagine_assets a
     INNER JOIN leads l ON l.id = a.lead_id
     WHERE a.id = ? LIMIT 1`,
    [assetId]
  );
  const row = rows[0];
  if (!row) return { asset: null, status: 404, error: 'asset not found' };
  if (row.lead_audit_id !== auditId) {
    // The asset exists but belongs to a different lead than the URL claims.
    return { asset: null, status: 404, error: 'asset not on this lead' };
  }
  return { asset: row, status: 200 };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { audit_id: string; asset_id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/commercial/[asset_id]',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const lookup = await resolveAsset(params.audit_id, params.asset_id);
  if (!lookup.asset) {
    return NextResponse.json({ error: lookup.error }, { status: lookup.status });
  }
  let asset = lookup.asset;

  // If a video is still 'running', try to resume the poll once on this read.
  // resumeRunningVideoAsset is a no-op for assets that aren't running videos.
  if (asset.asset_type === 'video' && asset.generation_status === 'running') {
    try {
      const resumed = await resumeRunningVideoAsset(asset.id);
      if (resumed && resumed.generationStatus !== 'running') {
        // Re-read the row so we return the freshly patched fields.
        const db = getAvDb();
        const [rows] = await db.execute<AssetRow[]>(
          `SELECT a.id, a.lead_id, a.asset_type, a.model, a.prompt, a.enhanced_prompt,
                  a.provider_request_id, a.storage_url, a.cost_usd, a.generation_status,
                  a.duration_seconds, a.resolution_tier, a.aspect_ratio, a.error_message,
                  a.created_at, a.completed_at, a.archived_at, l.audit_id AS lead_audit_id
           FROM grok_imagine_assets a
           INNER JOIN leads l ON l.id = a.lead_id
           WHERE a.id = ? LIMIT 1`,
          [asset.id]
        );
        if (rows[0]) asset = rows[0];
      }
    } catch (err) {
      console.error('[av:commercial:resume]', (err as Error).message);
      // fall through to returning the unchanged row
    }
  }

  return NextResponse.json({
    ok: true,
    asset: {
      assetId: asset.id,
      leadId: asset.lead_id,
      assetType: asset.asset_type,
      model: asset.model,
      url: asset.storage_url,
      costUsd: asset.cost_usd == null ? null : Number(asset.cost_usd),
      generationStatus: asset.generation_status,
      durationSeconds: asset.duration_seconds == null ? null : Number(asset.duration_seconds),
      resolutionTier: asset.resolution_tier,
      aspectRatio: asset.aspect_ratio,
      prompt: asset.prompt,
      enhancedPrompt: asset.enhanced_prompt,
      providerRequestId: asset.provider_request_id,
      errorMessage: asset.error_message,
      createdAt: asset.created_at,
      completedAt: asset.completed_at,
      archivedAt: asset.archived_at
    }
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { audit_id: string; asset_id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/commercial/[asset_id]:DELETE',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  // Owner-only soft delete (matches the kickoff spec).
  if (guard.actor.role !== 'owner') {
    return NextResponse.json({ error: 'forbidden -- owner only' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const lookup = await resolveAsset(params.audit_id, params.asset_id);
  if (!lookup.asset) {
    return NextResponse.json({ error: lookup.error }, { status: lookup.status });
  }

  try {
    const db = getAvDb();
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE grok_imagine_assets
         SET archived_at = NOW()
       WHERE id = ? AND archived_at IS NULL`,
      [lookup.asset.id]
    );
    return NextResponse.json({ ok: true, archived: result.affectedRows });
  } catch (err) {
    console.error('[av:commercial:delete]', (err as Error).message);
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}
