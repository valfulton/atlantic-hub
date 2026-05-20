/**
 * lib/grok/discoverer.ts
 *
 * Per-lead AI commercial generation orchestrator. Loads a lead, builds a
 * prompt suited to the asset type using the audit + company context,
 * calls Grok Imagine, persists the result, and logs the call.
 *
 * Public entry points:
 *   generateCommercialForLead(leadId, options) -- runs the full flow
 *   resumeRunningVideoAsset(assetId)           -- re-polls a pending video
 *
 * Cost / latency safety:
 *   - Image generation is synchronous and fast (~5-15s).
 *   - Video generation is async; we long-poll up to ~50s. If the poll budget
 *     elapses we persist the asset with status='running' + provider_request_id
 *     and the GET asset route will resume polling on demand.
 */

import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import {
  grokGenerateImage,
  grokStartVideo,
  grokAwaitVideo,
  grokPollVideoOnce,
  estimateImageCostUsd,
  estimateVideoCostUsd,
  GrokApiKeyMissingError,
  GrokApiError,
  GrokVideoTimeoutError,
  GrokVideoFailedError,
  type GrokImageModel,
  type GrokVideoModel,
  type GrokResolutionTier,
  type GrokAspectRatio
} from '@/lib/grok/imagine';
import {
  getActiveBriefForLead,
  generateVisualBriefForLead,
  visualBriefToPromptFragment,
  type VisualBriefRecord
} from '@/lib/ai/visual_brief';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export type AssetType = 'image' | 'video';
export type GenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** Where in the frame to leave clean negative space for a post-production logo overlay. */
export type LogoSpace =
  | 'none'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

interface LeadContextRow extends RowDataPacket {
  id: number;
  audit_id: string;
  company: string;
  industry: string | null;
  contact_title: string | null;
  website: string | null;
  audit_content: string | null;
  challenge: string | null;
}

interface AssetRow extends RowDataPacket {
  id: number;
  lead_id: number;
  asset_type: AssetType;
  model: string;
  prompt: string;
  enhanced_prompt: string | null;
  provider_request_id: string | null;
  storage_url: string | null;
  storage_path: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: string | number | null;
  resolution_tier: GrokResolutionTier;
  aspect_ratio: string | null;
  cost_usd: string | number | null;
  generation_status: GenerationStatus;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  archived_at: string | null;
  created_by_user_id: number | null;
}

export interface GenerateCommercialOptions {
  assetType: AssetType;
  /** Optional override of the AI-built prompt. */
  customPrompt?: string;
  /** Image model -- defaults to grok-imagine-image-quality. */
  imageModel?: GrokImageModel;
  /** Video model -- only one option today. */
  videoModel?: GrokVideoModel;
  /** Video length in seconds, 1-15. Defaults to 6. */
  durationSeconds?: number;
  resolution?: GrokResolutionTier;
  aspectRatio?: GrokAspectRatio;
  /** Defaults to 50_000 ms. Pass a smaller number if you want to fail-fast and resume later. */
  pollTimeoutMs?: number;
  /** Actor user id for the audit trail; ignored if null. */
  actorUserId?: number | null;
  /** If set to a corner, the auto-built prompt asks the model to leave clean
   *  negative space there for a post-production logo overlay. */
  logoSpace?: LogoSpace;
}

export interface GeneratedCommercial {
  assetId: number;
  leadId: number;
  assetType: AssetType;
  model: string;
  storageUrl: string | null;
  costUsd: number;
  prompt: string;
  generationStatus: GenerationStatus;
  providerRequestId: string | null;
  durationSeconds: number | null;
  resolutionTier: GrokResolutionTier;
  aspectRatio: string | null;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, '') + '...';
}

/**
 * Shared brand-safety clause appended to every commercial prompt.
 *
 * Tells the model: do not invent or include any brand, trademark, or
 * competitor name. The only brand allowed is the lead's own company
 * name (and even that is description-only -- the model must render no
 * actual text or logo).
 */
const BRAND_SAFETY_CLAUSE =
  'Do not render any text, logos, watermarks, brand names, trademarks, mascots, or competitor brand cues anywhere in the frame. ' +
  'No fictional brand insignia. Treat all visible signage as blank, generic, or out of focus.';

/** Translate a logo-space corner into a concrete negative-space instruction. */
function logoSpaceClause(space?: LogoSpace): string | null {
  if (!space || space === 'none') return null;
  const human: Record<Exclude<LogoSpace, 'none'>, string> = {
    'top-left': 'upper left',
    'top-right': 'upper right',
    'bottom-left': 'lower left',
    'bottom-right': 'lower right'
  };
  const corner = human[space];
  return `Reserve a clean, low-detail negative-space area in the ${corner} of the frame (soft, uncluttered background, no busy subject matter there) so a logo can be overlaid in post-production.`;
}

/**
 * Build the image generation prompt.
 *
 * Priority order:
 *   1. If an active VisualBrief exists for the lead, use it (Option C path).
 *   2. Otherwise fall back to company + industry + audit excerpt (legacy).
 *
 * The brief always wins because it was engineered specifically as visual
 * direction (hero shot, palette, motifs, persona, do-nots), whereas the
 * audit was engineered for sales strategy and gives generic prompts.
 */
function buildImagePrompt(
  lead: LeadContextRow,
  brief: VisualBriefRecord | null,
  logoSpace?: LogoSpace
): string {
  const industry = lead.industry ? lead.industry.replace(/_/g, ' ') : 'small business';
  const briefFragment = visualBriefToPromptFragment(brief);
  const logoClause = logoSpaceClause(logoSpace);

  if (briefFragment) {
    return [
      `Premium commercial hero image for ${lead.company}, an independent ${industry} business.`,
      `Authentic, magazine-quality advertising photography. Editorial lighting. Sharp focus on a single confident subject. Real-world feel, not stock-photo cliche.`,
      briefFragment,
      logoClause,
      BRAND_SAFETY_CLAUSE
    ]
      .filter(Boolean)
      .join(' ');
  }

  // Legacy fallback path (no visual brief yet)
  const auditSnippet = lead.audit_content ? truncate(lead.audit_content, 600) : '';
  return [
    `Premium commercial hero image for ${lead.company}, an independent ${industry} business.`,
    `Cinematic editorial lighting, sharp focus, magazine-quality advertising composition with one clear hero subject.`,
    auditSnippet ? `Tone cues from the brand audit: ${auditSnippet}` : null,
    `Mood: confident, inviting, premium. Warm, natural color palette. Real-world authenticity over stock-photo polish.`,
    logoClause,
    BRAND_SAFETY_CLAUSE
  ]
    .filter(Boolean)
    .join(' ');
}

function buildVideoPrompt(
  lead: LeadContextRow,
  durationSeconds: number,
  brief: VisualBriefRecord | null,
  logoSpace?: LogoSpace
): string {
  const industry = lead.industry ? lead.industry.replace(/_/g, ' ') : 'small business';
  const briefFragment = visualBriefToPromptFragment(brief);
  const logoClause = logoSpaceClause(logoSpace);

  if (briefFragment) {
    return [
      `${durationSeconds}-second premium commercial-style advertising video for ${lead.company}, an independent ${industry} business.`,
      `One clear hero moment. Fluid camera movement (slow push-in or smooth handheld). Cinematic depth of field. Editorial-grade lighting.`,
      briefFragment,
      `Real-world authentic feel, not stock-footage. Social-media ready framing.`,
      logoClause,
      BRAND_SAFETY_CLAUSE
    ]
      .filter(Boolean)
      .join(' ');
  }

  // Legacy fallback path
  const auditSnippet = lead.audit_content ? truncate(lead.audit_content, 500) : '';
  return [
    `${durationSeconds}-second premium commercial-style advertising video for ${lead.company}, an independent ${industry} business.`,
    `Cinematic, fluid camera movement, premium product/lifestyle shots, golden-hour or editorial studio lighting. One clear hero moment within the cut.`,
    auditSnippet ? `Brand tone cues from the audit: ${auditSnippet}` : null,
    `Pacing: confident, premium, never frantic. Real-world authentic feel over stock-footage gloss.`,
    logoClause,
    BRAND_SAFETY_CLAUSE
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Public helper so API routes can preview the prompt that WOULD be used
 * for a given lead + asset type, without actually calling the model.
 * Uses the current active visual brief if one exists; does not generate
 * a brief on the fly.
 */
export async function buildPromptForLead(
  leadId: number,
  args: {
    assetType: AssetType;
    durationSeconds?: number;
    logoSpace?: LogoSpace;
  }
): Promise<{ prompt: string; source: 'visual_brief' | 'audit' | 'fallback'; briefId: number | null } | null> {
  const lead = await loadLeadContext(leadId);
  if (!lead) return null;
  const brief = await getActiveBriefForLead(lead.id);
  const source: 'visual_brief' | 'audit' | 'fallback' = brief
    ? 'visual_brief'
    : lead.audit_content
    ? 'audit'
    : 'fallback';
  const prompt =
    args.assetType === 'image'
      ? buildImagePrompt(lead, brief, args.logoSpace)
      : buildVideoPrompt(lead, Math.max(1, Math.min(15, args.durationSeconds ?? 6)), brief, args.logoSpace);
  return { prompt, source, briefId: brief?.id ?? null };
}

// ---------------------------------------------------------------------
// Best-effort event logging -- never throws
// ---------------------------------------------------------------------

async function tryLogEvent(args: {
  eventType: string;
  leadId: number | null;
  userId: number | null;
  status: 'success' | 'failure' | 'partial' | 'pending';
  payload?: object;
  errorMessage?: string;
  executionTimeMs?: number;
}): Promise<void> {
  try {
    // Skip silently if system_events table is missing -- logEvent itself swallows
    // most errors but a "table missing" error would surface in console.error.
    // For now we always call it; the events session has already shipped 010.
    await logEvent({
      eventType: args.eventType,
      leadId: args.leadId,
      userId: args.userId,
      source: 'grok',
      payload: args.payload,
      status: args.status,
      errorMessage: args.errorMessage,
      executionTimeMs: args.executionTimeMs
    });
  } catch {
    // logEvent is supposed to swallow its own errors; belt+suspenders.
  }
}

// ---------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------

async function loadLeadContext(leadId: number): Promise<LeadContextRow | null> {
  const db = getAvDb();
  const [rows] = await db.execute<LeadContextRow[]>(
    `SELECT id, audit_id, company, industry, contact_title, website, audit_content, challenge
     FROM leads
     WHERE id = ? AND archived_at IS NULL
     LIMIT 1`,
    [leadId]
  );
  return rows[0] ?? null;
}

async function insertAssetRow(args: {
  leadId: number;
  assetType: AssetType;
  model: string;
  prompt: string;
  enhancedPrompt: string | null;
  resolutionTier: GrokResolutionTier;
  aspectRatio: string | null;
  durationSeconds: number | null;
  generationStatus: GenerationStatus;
  costUsd: number | null;
  providerRequestId: string | null;
  storageUrl: string | null;
  errorMessage: string | null;
  createdByUserId: number | null;
}): Promise<number> {
  const db = getAvDb();
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO grok_imagine_assets
       (lead_id, asset_type, model, prompt, enhanced_prompt, resolution_tier,
        aspect_ratio, duration_seconds, generation_status, cost_usd,
        provider_request_id, storage_url, error_message, created_by_user_id,
        completed_at)
     VALUES
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        CASE WHEN ? IN ('succeeded','failed') THEN NOW() ELSE NULL END)`,
    [
      args.leadId,
      args.assetType,
      args.model,
      args.prompt,
      args.enhancedPrompt,
      args.resolutionTier,
      args.aspectRatio,
      args.durationSeconds,
      args.generationStatus,
      args.costUsd,
      args.providerRequestId,
      args.storageUrl,
      args.errorMessage,
      args.createdByUserId,
      args.generationStatus
    ]
  );
  return result.insertId;
}

async function logGrokCall(args: {
  endpoint: string;
  leadId: number | null;
  assetId: number | null;
  model: string;
  costUsd: number | null;
  latencyMs: number;
  outcome: 'success' | 'rate_limited' | 'error' | 'quota_exceeded';
  errorMessage: string | null;
  actorUserId: number | null;
}): Promise<void> {
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `INSERT INTO grok_imagine_log
         (endpoint, lead_id, asset_id, model, cost_usd, latency_ms,
          outcome, error_message, actor_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        args.endpoint,
        args.leadId,
        args.assetId,
        args.model,
        args.costUsd,
        args.latencyMs,
        args.outcome,
        args.errorMessage ? args.errorMessage.slice(0, 500) : null,
        args.actorUserId
      ]
    );
  } catch (err) {
    // Mirror logEvent's contract: never blow up the caller because logging failed.
    console.error('[grok:log]', (err as Error).message);
  }
}

async function patchAssetWithResult(args: {
  assetId: number;
  storageUrl: string;
  durationSeconds: number | null;
  costUsd: number;
}): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `UPDATE grok_imagine_assets
       SET storage_url = ?,
           duration_seconds = COALESCE(?, duration_seconds),
           cost_usd = ?,
           generation_status = 'succeeded',
           completed_at = NOW(),
           error_message = NULL
     WHERE id = ?`,
    [args.storageUrl, args.durationSeconds, args.costUsd, args.assetId]
  );
}

async function patchAssetWithFailure(args: { assetId: number; errorMessage: string }): Promise<void> {
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `UPDATE grok_imagine_assets
       SET generation_status = 'failed',
           completed_at = NOW(),
           error_message = ?
     WHERE id = ?`,
    [args.errorMessage.slice(0, 500), args.assetId]
  );
}

// ---------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------

export async function generateCommercialForLead(
  leadId: number,
  options: GenerateCommercialOptions
): Promise<GeneratedCommercial> {
  const lead = await loadLeadContext(leadId);
  if (!lead) {
    throw new Error(`lead ${leadId} not found or archived`);
  }

  const actorUserId = options.actorUserId ?? null;
  const resolution: GrokResolutionTier = options.resolution ?? '1k';
  const aspectRatio: GrokAspectRatio = options.aspectRatio ?? '16:9';

  if (options.assetType === 'image') {
    return generateImageCommercial({ lead, options, actorUserId, resolution, aspectRatio });
  }
  return generateVideoCommercial({ lead, options, actorUserId, resolution, aspectRatio });
}

async function generateImageCommercial(args: {
  lead: LeadContextRow;
  options: GenerateCommercialOptions;
  actorUserId: number | null;
  resolution: GrokResolutionTier;
  aspectRatio: GrokAspectRatio;
}): Promise<GeneratedCommercial> {
  const { lead, options, actorUserId, resolution, aspectRatio } = args;
  const model: GrokImageModel = options.imageModel ?? 'grok-imagine-image-quality';

  // Pull or auto-generate the visual brief unless caller supplied a custom prompt.
  let brief: VisualBriefRecord | null = null;
  if (!options.customPrompt) {
    brief = await getActiveBriefForLead(lead.id);
    if (!brief && lead.audit_content) {
      // First commercial on this lead and we have audit material -> build a brief now.
      try {
        brief = await generateVisualBriefForLead(lead.id, { actorUserId });
      } catch {
        brief = null; // fall through to legacy prompt
      }
    }
  }

  const builtPrompt = buildImagePrompt(lead, brief, options.logoSpace);
  const effectivePrompt = options.customPrompt?.trim() || builtPrompt;

  const startMs = Date.now();
  let assetId: number | null = null;

  try {
    const results = await grokGenerateImage({
      prompt: effectivePrompt,
      model,
      resolution,
      aspectRatio,
      n: 1
    });
    const result = results[0];
    const latency = Date.now() - startMs;

    assetId = await insertAssetRow({
      leadId: lead.id,
      assetType: 'image',
      model: result.model,
      prompt: effectivePrompt,
      enhancedPrompt: result.revisedPrompt ?? null,
      resolutionTier: resolution,
      aspectRatio,
      durationSeconds: null,
      generationStatus: 'succeeded',
      costUsd: result.costUsd,
      providerRequestId: null,
      storageUrl: result.imageUrl,
      errorMessage: null,
      createdByUserId: actorUserId
    });

    await Promise.all([
      logGrokCall({
        endpoint: '/v1/images/generations',
        leadId: lead.id,
        assetId,
        model: result.model,
        costUsd: result.costUsd,
        latencyMs: latency,
        outcome: 'success',
        errorMessage: null,
        actorUserId
      }),
      tryLogEvent({
        eventType: 'commercial.generated',
        leadId: lead.id,
        userId: actorUserId,
        status: 'success',
        payload: {
          asset_id: assetId,
          asset_type: 'image',
          model: result.model,
          cost_usd: result.costUsd,
          resolution,
          aspect_ratio: aspectRatio
        },
        executionTimeMs: latency
      })
    ]);

    return {
      assetId,
      leadId: lead.id,
      assetType: 'image',
      model: result.model,
      storageUrl: result.imageUrl,
      costUsd: result.costUsd,
      prompt: effectivePrompt,
      generationStatus: 'succeeded',
      providerRequestId: null,
      durationSeconds: null,
      resolutionTier: resolution,
      aspectRatio,
      errorMessage: null
    };
  } catch (err) {
    const latency = Date.now() - startMs;
    const outcome =
      err instanceof GrokApiError && err.status === 429 ? 'rate_limited' : 'error';
    const errorMessage = (err as Error).message;

    // Persist a failed row only if we haven't yet (i.e. error happened during the API call).
    if (assetId === null) {
      try {
        assetId = await insertAssetRow({
          leadId: lead.id,
          assetType: 'image',
          model,
          prompt: effectivePrompt,
          enhancedPrompt: null,
          resolutionTier: resolution,
          aspectRatio,
          durationSeconds: null,
          generationStatus: 'failed',
          costUsd: null,
          providerRequestId: null,
          storageUrl: null,
          errorMessage: errorMessage.slice(0, 500),
          createdByUserId: actorUserId
        });
      } catch {
        // swallow -- we still want to log the call below
      }
    }

    await logGrokCall({
      endpoint: '/v1/images/generations',
      leadId: lead.id,
      assetId,
      model,
      costUsd: null,
      latencyMs: latency,
      outcome,
      errorMessage,
      actorUserId
    });
    await tryLogEvent({
      eventType: err instanceof GrokApiKeyMissingError ? 'api.openai_error' : 'workflow.failed',
      leadId: lead.id,
      userId: actorUserId,
      status: 'failure',
      payload: { route: 'grok.image', model, asset_type: 'image' },
      errorMessage,
      executionTimeMs: latency
    });

    throw err;
  }
}

async function generateVideoCommercial(args: {
  lead: LeadContextRow;
  options: GenerateCommercialOptions;
  actorUserId: number | null;
  resolution: GrokResolutionTier;
  aspectRatio: GrokAspectRatio;
}): Promise<GeneratedCommercial> {
  const { lead, options, actorUserId, resolution, aspectRatio } = args;
  const model: GrokVideoModel = options.videoModel ?? 'grok-imagine-video';
  const duration = Math.max(1, Math.min(15, Math.round(options.durationSeconds ?? 6)));

  let brief: VisualBriefRecord | null = null;
  if (!options.customPrompt) {
    brief = await getActiveBriefForLead(lead.id);
    if (!brief && lead.audit_content) {
      try {
        brief = await generateVisualBriefForLead(lead.id, { actorUserId });
      } catch {
        brief = null;
      }
    }
  }

  const builtPrompt = buildVideoPrompt(lead, duration, brief, options.logoSpace);
  const effectivePrompt = options.customPrompt?.trim() || builtPrompt;
  const pollTimeoutMs = options.pollTimeoutMs ?? 50_000;

  const startMs = Date.now();
  let assetId: number | null = null;
  let providerRequestId: string | null = null;
  let pendingCost: number | null = estimateVideoCostUsd(duration);

  try {
    const startResult = await grokStartVideo({
      prompt: effectivePrompt,
      model,
      durationSeconds: duration,
      resolution,
      aspectRatio
    });
    providerRequestId = startResult.requestId;
    pendingCost = startResult.costUsd;

    // Insert as 'running' first so the UI can show the pending asset immediately.
    assetId = await insertAssetRow({
      leadId: lead.id,
      assetType: 'video',
      model: startResult.model,
      prompt: effectivePrompt,
      enhancedPrompt: null,
      resolutionTier: resolution,
      aspectRatio,
      durationSeconds: duration,
      generationStatus: 'running',
      costUsd: pendingCost,
      providerRequestId,
      storageUrl: null,
      errorMessage: null,
      createdByUserId: actorUserId
    });

    // Now long-poll within the budget.
    const completed = await grokAwaitVideo(providerRequestId, {
      pollTimeoutMs,
      pollIntervalMs: 3000
    });

    await patchAssetWithResult({
      assetId,
      storageUrl: completed.videoUrl,
      durationSeconds: completed.durationSeconds || duration,
      costUsd: completed.costUsd
    });

    const latency = Date.now() - startMs;
    await Promise.all([
      logGrokCall({
        endpoint: '/v1/videos/generations',
        leadId: lead.id,
        assetId,
        model: completed.model,
        costUsd: completed.costUsd,
        latencyMs: latency,
        outcome: 'success',
        errorMessage: null,
        actorUserId
      }),
      tryLogEvent({
        eventType: 'commercial.generated',
        leadId: lead.id,
        userId: actorUserId,
        status: 'success',
        payload: {
          asset_id: assetId,
          asset_type: 'video',
          model: completed.model,
          cost_usd: completed.costUsd,
          duration_seconds: completed.durationSeconds,
          resolution,
          aspect_ratio: aspectRatio
        },
        executionTimeMs: latency
      })
    ]);

    return {
      assetId,
      leadId: lead.id,
      assetType: 'video',
      model: completed.model,
      storageUrl: completed.videoUrl,
      costUsd: completed.costUsd,
      prompt: effectivePrompt,
      generationStatus: 'succeeded',
      providerRequestId,
      durationSeconds: completed.durationSeconds || duration,
      resolutionTier: resolution,
      aspectRatio,
      errorMessage: null
    };
  } catch (err) {
    const latency = Date.now() - startMs;

    // Special case: video job is still running on xAI side, we just hit our
    // poll budget. Leave the row in 'running' state with provider_request_id
    // set so the GET asset endpoint can resume polling.
    if (err instanceof GrokVideoTimeoutError && assetId !== null) {
      await logGrokCall({
        endpoint: '/v1/videos/generations',
        leadId: lead.id,
        assetId,
        model,
        costUsd: pendingCost,
        latencyMs: latency,
        outcome: 'success',
        errorMessage: 'poll-budget-exhausted-still-pending',
        actorUserId
      });
      await tryLogEvent({
        eventType: 'commercial.generated',
        leadId: lead.id,
        userId: actorUserId,
        status: 'pending',
        payload: {
          asset_id: assetId,
          asset_type: 'video',
          model,
          provider_request_id: providerRequestId,
          duration_seconds: duration
        },
        executionTimeMs: latency
      });

      return {
        assetId,
        leadId: lead.id,
        assetType: 'video',
        model,
        storageUrl: null,
        costUsd: pendingCost ?? 0,
        prompt: effectivePrompt,
        generationStatus: 'running',
        providerRequestId,
        durationSeconds: duration,
        resolutionTier: resolution,
        aspectRatio,
        errorMessage: null
      };
    }

    const errorMessage = (err as Error).message;
    const outcome =
      err instanceof GrokApiError && err.status === 429 ? 'rate_limited' : 'error';

    if (assetId === null) {
      try {
        assetId = await insertAssetRow({
          leadId: lead.id,
          assetType: 'video',
          model,
          prompt: effectivePrompt,
          enhancedPrompt: null,
          resolutionTier: resolution,
          aspectRatio,
          durationSeconds: duration,
          generationStatus: 'failed',
          costUsd: null,
          providerRequestId,
          storageUrl: null,
          errorMessage: errorMessage.slice(0, 500),
          createdByUserId: actorUserId
        });
      } catch {
        // swallow
      }
    } else {
      await patchAssetWithFailure({ assetId, errorMessage });
    }

    await logGrokCall({
      endpoint: '/v1/videos/generations',
      leadId: lead.id,
      assetId,
      model,
      costUsd: null,
      latencyMs: latency,
      outcome,
      errorMessage,
      actorUserId
    });
    await tryLogEvent({
      eventType: err instanceof GrokVideoFailedError ? 'workflow.failed' : 'api.openai_error',
      leadId: lead.id,
      userId: actorUserId,
      status: 'failure',
      payload: { route: 'grok.video', model, provider_request_id: providerRequestId },
      errorMessage,
      executionTimeMs: latency
    });

    throw err;
  }
}

/**
 * Re-poll a video asset that was left in 'running' state because its first
 * generation exceeded the poll budget. Called from the GET asset endpoint
 * when a UI client asks for status on a running asset.
 *
 * If the upstream job is still pending we return the asset as-is.
 * If done -> patch the row to 'succeeded' and return the URL.
 * If failed/expired -> patch the row to 'failed' and return the error.
 */
export async function resumeRunningVideoAsset(assetId: number): Promise<GeneratedCommercial | null> {
  const db = getAvDb();
  const [rows] = await db.execute<AssetRow[]>(
    `SELECT id, lead_id, asset_type, model, prompt, enhanced_prompt, provider_request_id,
            storage_url, storage_path, mime_type, width, height, duration_seconds,
            resolution_tier, aspect_ratio, cost_usd, generation_status, error_message,
            created_at, completed_at, archived_at, created_by_user_id
     FROM grok_imagine_assets
     WHERE id = ? LIMIT 1`,
    [assetId]
  );
  const asset = rows[0];
  if (!asset) return null;

  // Only video assets in 'running' state with a provider_request_id can resume.
  if (
    asset.asset_type !== 'video' ||
    asset.generation_status !== 'running' ||
    !asset.provider_request_id
  ) {
    return assetRowToShape(asset);
  }

  try {
    const status = await grokPollVideoOnce(asset.provider_request_id);

    if (status.status === 'done' && status.videoUrl) {
      const finalDuration = status.durationSeconds ?? Number(asset.duration_seconds ?? 0) ?? null;
      const finalCost = estimateVideoCostUsd(finalDuration ?? 0);
      await patchAssetWithResult({
        assetId,
        storageUrl: status.videoUrl,
        durationSeconds: finalDuration,
        costUsd: finalCost
      });
      await logGrokCall({
        endpoint: '/v1/videos/{request_id}',
        leadId: asset.lead_id,
        assetId,
        model: asset.model,
        costUsd: finalCost,
        latencyMs: 0,
        outcome: 'success',
        errorMessage: 'resumed-poll',
        actorUserId: asset.created_by_user_id
      });
      await tryLogEvent({
        eventType: 'commercial.generated',
        leadId: asset.lead_id,
        userId: asset.created_by_user_id,
        status: 'success',
        payload: { asset_id: assetId, resumed_poll: true, asset_type: 'video' }
      });
      return {
        assetId,
        leadId: asset.lead_id,
        assetType: 'video',
        model: asset.model,
        storageUrl: status.videoUrl,
        costUsd: finalCost,
        prompt: asset.prompt,
        generationStatus: 'succeeded',
        providerRequestId: asset.provider_request_id,
        durationSeconds: finalDuration,
        resolutionTier: asset.resolution_tier,
        aspectRatio: asset.aspect_ratio,
        errorMessage: null
      };
    }

    if (status.status === 'failed' || status.status === 'expired') {
      const msg = status.errorMessage ?? `video ${status.status}`;
      await patchAssetWithFailure({ assetId, errorMessage: msg });
      await logGrokCall({
        endpoint: '/v1/videos/{request_id}',
        leadId: asset.lead_id,
        assetId,
        model: asset.model,
        costUsd: null,
        latencyMs: 0,
        outcome: 'error',
        errorMessage: msg,
        actorUserId: asset.created_by_user_id
      });
      return {
        ...assetRowToShape(asset),
        generationStatus: 'failed',
        errorMessage: msg
      };
    }

    // Still pending -- return unchanged shape.
    return assetRowToShape(asset);
  } catch (err) {
    // Don't mutate the row on transient errors; the caller can retry.
    console.error('[grok:resume]', (err as Error).message);
    return assetRowToShape(asset);
  }
}

function assetRowToShape(asset: AssetRow): GeneratedCommercial {
  return {
    assetId: asset.id,
    leadId: asset.lead_id,
    assetType: asset.asset_type,
    model: asset.model,
    storageUrl: asset.storage_url,
    costUsd: asset.cost_usd == null ? 0 : Number(asset.cost_usd),
    prompt: asset.prompt,
    generationStatus: asset.generation_status,
    providerRequestId: asset.provider_request_id,
    durationSeconds: asset.duration_seconds == null ? null : Number(asset.duration_seconds),
    resolutionTier: asset.resolution_tier,
    aspectRatio: asset.aspect_ratio,
    errorMessage: asset.error_message
  };
}
