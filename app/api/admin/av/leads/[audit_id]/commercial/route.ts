/**
 * POST /api/admin/av/leads/[audit_id]/commercial
 *
 * Generate an AI commercial (image or short video) for a specific lead via
 * xAI Grok Imagine. Owner + staff only. Forbidden for client_user.
 *
 * Body:
 *   {
 *     assetType: 'image' | 'video',
 *     imageModel?: 'grok-imagine-image' | 'grok-imagine-image-quality' | 'grok-imagine-image-pro',
 *     durationSeconds?: number (1-15, video only, default 6),
 *     resolution?: '1k' | '2k',
 *     aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3',
 *     customPrompt?: string
 *   }
 *
 * Response (success):
 *   {
 *     ok: true,
 *     assetId,
 *     assetType,
 *     model,
 *     url,                  // null when generationStatus === 'running'
 *     generationStatus,     // 'succeeded' | 'running' | 'failed'
 *     costUsd,
 *     prompt,
 *     providerRequestId,
 *     durationSeconds,
 *     resolutionTier,
 *     aspectRatio
 *   }
 *
 * Notes on timing:
 *   - Image generation completes synchronously (~5-15s).
 *   - Video generation polls inline up to ~50s. If the upstream job is not
 *     done within that budget the response returns generationStatus='running'
 *     and the UI should poll GET /commercial/[asset_id] until 'succeeded'.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { generateCommercialForLead } from '@/lib/grok/discoverer';
import {
  GrokApiKeyMissingError,
  GrokApiError,
  GrokVideoFailedError,
  type GrokImageModel,
  type GrokResolutionTier,
  type GrokAspectRatio
} from '@/lib/grok/imagine';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_IMAGE_MODELS = new Set<GrokImageModel>([
  'grok-imagine-image',
  'grok-imagine-image-quality',
  'grok-imagine-image-pro'
]);
const VALID_RESOLUTIONS = new Set<GrokResolutionTier>(['1k', '2k']);
const VALID_ASPECT_RATIOS = new Set<GrokAspectRatio>([
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3'
]);

export async function POST(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/commercial',
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

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const assetType = payload.assetType === 'video' ? 'video' : payload.assetType === 'image' ? 'image' : null;
  if (!assetType) {
    return NextResponse.json({ error: 'assetType must be "image" or "video"' }, { status: 400 });
  }

  // Optional fields with validation
  let imageModel: GrokImageModel | undefined;
  if (typeof payload.imageModel === 'string') {
    if (!VALID_IMAGE_MODELS.has(payload.imageModel as GrokImageModel)) {
      return NextResponse.json({ error: 'invalid imageModel' }, { status: 400 });
    }
    imageModel = payload.imageModel as GrokImageModel;
  }

  let resolution: GrokResolutionTier | undefined;
  if (typeof payload.resolution === 'string') {
    if (!VALID_RESOLUTIONS.has(payload.resolution as GrokResolutionTier)) {
      return NextResponse.json({ error: 'invalid resolution' }, { status: 400 });
    }
    resolution = payload.resolution as GrokResolutionTier;
  }

  let aspectRatio: GrokAspectRatio | undefined;
  if (typeof payload.aspectRatio === 'string') {
    if (!VALID_ASPECT_RATIOS.has(payload.aspectRatio as GrokAspectRatio)) {
      return NextResponse.json({ error: 'invalid aspectRatio' }, { status: 400 });
    }
    aspectRatio = payload.aspectRatio as GrokAspectRatio;
  }

  let durationSeconds: number | undefined;
  if (payload.durationSeconds !== undefined) {
    const n = Number(payload.durationSeconds);
    if (!Number.isFinite(n) || n < 1 || n > 15) {
      return NextResponse.json({ error: 'durationSeconds must be a number 1-15' }, { status: 400 });
    }
    durationSeconds = Math.round(n);
  }

  let customPrompt: string | undefined;
  if (typeof payload.customPrompt === 'string' && payload.customPrompt.trim().length > 0) {
    if (payload.customPrompt.length > 4000) {
      return NextResponse.json({ error: 'customPrompt max 4000 chars' }, { status: 400 });
    }
    customPrompt = payload.customPrompt.trim();
  }

  // Resolve the audit_id -> internal lead id.
  const db = getAvDb();
  const [leadRows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
    [params.audit_id]
  );
  if (leadRows.length === 0) {
    return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  }
  const leadId = leadRows[0].id;

  try {
    const result = await generateCommercialForLead(leadId, {
      assetType,
      customPrompt,
      imageModel,
      durationSeconds,
      resolution,
      aspectRatio,
      actorUserId: guard.actor.userId
    });

    return NextResponse.json({
      ok: true,
      assetId: result.assetId,
      assetType: result.assetType,
      model: result.model,
      url: result.storageUrl,
      generationStatus: result.generationStatus,
      costUsd: result.costUsd,
      prompt: result.prompt,
      providerRequestId: result.providerRequestId,
      durationSeconds: result.durationSeconds,
      resolutionTier: result.resolutionTier,
      aspectRatio: result.aspectRatio
    });
  } catch (err) {
    if (err instanceof GrokApiKeyMissingError) {
      return NextResponse.json(
        { error: 'XAI_API_KEY not configured in Netlify env vars' },
        { status: 503 }
      );
    }
    if (err instanceof GrokApiError) {
      return NextResponse.json(
        {
          error: 'xai api error',
          detail: err.body.slice(0, 500),
          status: err.status
        },
        { status: err.status === 429 ? 429 : 502 }
      );
    }
    if (err instanceof GrokVideoFailedError) {
      return NextResponse.json(
        {
          error: 'video generation failed',
          code: err.code,
          providerRequestId: err.requestId,
          detail: err.message
        },
        { status: 502 }
      );
    }
    console.error('[av:commercial:create]', (err as Error).message);
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name, message: (err as Error).message.slice(0, 300) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/av/leads/[audit_id]/commercial
 *
 * List all non-archived commercial assets for a lead, newest first.
 * Owner + staff only.
 */
interface AssetListRow extends RowDataPacket {
  id: number;
  asset_type: 'image' | 'video';
  model: string;
  storage_url: string | null;
  cost_usd: string | number | null;
  generation_status: 'queued' | 'running' | 'succeeded' | 'failed';
  duration_seconds: string | number | null;
  resolution_tier: '1k' | '2k';
  aspect_ratio: string | null;
  prompt: string;
  enhanced_prompt: string | null;
  error_message: string | null;
  provider_request_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export async function GET(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/commercial:GET',
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

  try {
    const db = getAvDb();
    const [leadRows] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
      [params.audit_id]
    );
    if (leadRows.length === 0) {
      return NextResponse.json({ error: 'lead not found' }, { status: 404 });
    }
    const leadId = leadRows[0].id;

    const [rows] = await db.execute<AssetListRow[]>(
      `SELECT id, asset_type, model, storage_url, cost_usd, generation_status,
              duration_seconds, resolution_tier, aspect_ratio, prompt, enhanced_prompt,
              error_message, provider_request_id, created_at, completed_at
       FROM grok_imagine_assets
       WHERE lead_id = ? AND archived_at IS NULL
       ORDER BY created_at DESC
       LIMIT 200`,
      [leadId]
    );

    return NextResponse.json({
      ok: true,
      leadId,
      assets: rows.map((r) => ({
        assetId: r.id,
        assetType: r.asset_type,
        model: r.model,
        url: r.storage_url,
        costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
        generationStatus: r.generation_status,
        durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
        resolutionTier: r.resolution_tier,
        aspectRatio: r.aspect_ratio,
        prompt: r.prompt,
        enhancedPrompt: r.enhanced_prompt,
        errorMessage: r.error_message,
        providerRequestId: r.provider_request_id,
        createdAt: r.created_at,
        completedAt: r.completed_at
      }))
    });
  } catch (err) {
    console.error('[av:commercial:list]', (err as Error).message);
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}
