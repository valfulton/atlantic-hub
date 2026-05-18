/**
 * lib/grok/imagine.ts
 *
 * Minimal xAI Grok Imagine client. No SDK dependency -- direct fetch to keep
 * the Netlify function bundle small. Mirrors lib/openai/client.ts in shape.
 *
 * Used by:
 *   - lib/grok/discoverer.ts (per-lead commercial generation orchestrator)
 *   - app/api/admin/av/leads/[audit_id]/commercial/* (route handlers)
 *
 * Reads XAI_API_KEY from process.env.
 *
 * API summary (validated 2026-05-18 against docs.x.ai):
 *   - Image:  POST /v1/images/generations  (sync, returns URL in response)
 *   - Video:  POST /v1/videos/generations  (async, returns { request_id })
 *             GET  /v1/videos/{request_id} (poll until status === 'done')
 *
 * Pricing (per kickoff doc):
 *   grok-imagine-image          $0.02 / image
 *   grok-imagine-image-quality  $0.05 / image
 *   grok-imagine-image-pro      $0.07 / image  (DEPRECATED 2026-05-15)
 *   grok-imagine-video          $0.05 / second
 *
 * Note on resolution mapping: the public API uses '480p' / '720p' for video
 * and a free-form 'size' for image. We expose a friendly '1k' / '2k' enum
 * matching the schema and translate at call time.
 */

const GROK_BASE = 'https://api.x.ai/v1';
const DEFAULT_IMAGE_MODEL: GrokImageModel = 'grok-imagine-image-quality';
const DEFAULT_VIDEO_MODEL: GrokVideoModel = 'grok-imagine-video';

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

export class GrokApiKeyMissingError extends Error {
  constructor() {
    super('XAI_API_KEY is not set in Netlify environment variables');
    this.name = 'GrokApiKeyMissingError';
  }
}

export class GrokApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`xAI Grok API error ${status}: ${body.slice(0, 200)}`);
    this.name = 'GrokApiError';
    this.status = status;
    this.body = body;
  }
}

export class GrokVideoTimeoutError extends Error {
  requestId: string;
  constructor(requestId: string) {
    super(`Grok video generation did not complete within the poll budget (request_id=${requestId})`);
    this.name = 'GrokVideoTimeoutError';
    this.requestId = requestId;
  }
}

export class GrokVideoFailedError extends Error {
  requestId: string;
  code: string | null;
  constructor(requestId: string, code: string | null, message: string) {
    super(`Grok video generation failed (request_id=${requestId}, code=${code}): ${message}`);
    this.name = 'GrokVideoFailedError';
    this.requestId = requestId;
    this.code = code;
  }
}

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type GrokImageModel =
  | 'grok-imagine-image'
  | 'grok-imagine-image-quality'
  | 'grok-imagine-image-pro';

export type GrokVideoModel = 'grok-imagine-video';

export type GrokResolutionTier = '1k' | '2k';

export type GrokAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3';

export interface GrokImageRequest {
  prompt: string;
  model?: GrokImageModel;
  resolution?: GrokResolutionTier;
  aspectRatio?: GrokAspectRatio;
  /** Number of images to generate. Defaults to 1. */
  n?: number;
}

export interface GrokImageResult {
  imageUrl: string;
  base64?: string;
  revisedPrompt?: string;
  model: string;
  costUsd: number;
}

export interface GrokVideoRequest {
  prompt: string;
  model?: GrokVideoModel;
  /** Seconds, 1-15. Defaults to 6. */
  durationSeconds?: number;
  resolution?: GrokResolutionTier;
  aspectRatio?: GrokAspectRatio;
  /** Optional override for max time to wait for the async job. Defaults to 50s. */
  pollTimeoutMs?: number;
  /** Optional override for poll interval. Defaults to 3s. */
  pollIntervalMs?: number;
}

export interface GrokVideoStartResult {
  requestId: string;
  model: string;
  /** Estimated cost based on the requested duration. */
  costUsd: number;
}

export interface GrokVideoCompleteResult {
  videoUrl: string;
  durationSeconds: number;
  revisedPrompt?: string;
  model: string;
  requestId: string;
  costUsd: number;
}

export interface GrokVideoStatusResult {
  status: 'pending' | 'done' | 'failed' | 'expired';
  requestId: string;
  videoUrl?: string;
  durationSeconds?: number;
  model?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}

// ---------------------------------------------------------------------
// Cost helpers
// ---------------------------------------------------------------------

export function estimateImageCostUsd(model: GrokImageModel, n: number): number {
  const perImage =
    model === 'grok-imagine-image-pro'
      ? 0.07
      : model === 'grok-imagine-image-quality'
      ? 0.05
      : 0.02;
  return Math.round(perImage * n * 10000) / 10000;
}

export function estimateVideoCostUsd(durationSeconds: number): number {
  return Math.round(0.05 * durationSeconds * 10000) / 10000;
}

// ---------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new GrokApiKeyMissingError();
  return key;
}

function imageSizeFor(resolution: GrokResolutionTier | undefined): string | undefined {
  // The API also accepts no `size` (defaults to model's native). We only set it
  // when the caller asks for 2k specifically.
  if (resolution === '2k') return '2048x2048';
  return undefined;
}

function videoResolutionFor(resolution: GrokResolutionTier | undefined): '480p' | '720p' {
  return resolution === '2k' ? '720p' : '480p';
}

// ---------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------

interface RawImageApiResponse {
  data?: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
  model?: string;
}

export async function grokGenerateImage(req: GrokImageRequest): Promise<GrokImageResult[]> {
  const apiKey = getApiKey();
  const model = req.model ?? DEFAULT_IMAGE_MODEL;
  const n = Math.max(1, Math.min(4, req.n ?? 1));

  const body: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    n,
    response_format: 'url'
  };
  const size = imageSizeFor(req.resolution);
  if (size) body.size = size;
  if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;

  const res = await fetch(`${GROK_BASE}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new GrokApiError(res.status, errText);
  }

  const json = (await res.json()) as RawImageApiResponse;
  const data = json.data ?? [];
  if (data.length === 0) {
    throw new GrokApiError(502, 'xAI returned empty data array for image generation');
  }

  const perImageCost = estimateImageCostUsd(model, 1);
  return data.map((entry) => ({
    imageUrl: entry.url ?? '',
    base64: entry.b64_json,
    revisedPrompt: entry.revised_prompt,
    model: json.model ?? model,
    costUsd: perImageCost
  }));
}

// ---------------------------------------------------------------------
// Video generation -- async two-step flow
// ---------------------------------------------------------------------

interface RawVideoStartResponse {
  request_id?: string;
  model?: string;
}

interface RawVideoStatusResponse {
  status?: 'pending' | 'done' | 'failed' | 'expired';
  model?: string;
  video?: {
    url?: string;
    duration?: number;
    respect_moderation?: boolean;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

/**
 * Step 1: kick off the video job. Returns the request_id immediately.
 * Use grokPollVideo() or grokGenerateVideo() to await the result.
 */
export async function grokStartVideo(req: GrokVideoRequest): Promise<GrokVideoStartResult> {
  const apiKey = getApiKey();
  const model = req.model ?? DEFAULT_VIDEO_MODEL;
  const duration = Math.max(1, Math.min(15, Math.round(req.durationSeconds ?? 6)));

  const body: Record<string, unknown> = {
    model,
    prompt: req.prompt,
    duration,
    aspect_ratio: req.aspectRatio ?? '16:9',
    resolution: videoResolutionFor(req.resolution)
  };

  const res = await fetch(`${GROK_BASE}/videos/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new GrokApiError(res.status, errText);
  }

  const json = (await res.json()) as RawVideoStartResponse;
  if (!json.request_id) {
    throw new GrokApiError(502, 'xAI did not return request_id for video generation');
  }

  return {
    requestId: json.request_id,
    model: json.model ?? model,
    costUsd: estimateVideoCostUsd(duration)
  };
}

/** Step 2 (one-shot): GET /v1/videos/{request_id} -- single status check. */
export async function grokPollVideoOnce(requestId: string): Promise<GrokVideoStatusResult> {
  const apiKey = getApiKey();
  const res = await fetch(`${GROK_BASE}/videos/${encodeURIComponent(requestId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new GrokApiError(res.status, errText);
  }

  const json = (await res.json()) as RawVideoStatusResponse;
  const status = json.status ?? 'pending';

  return {
    status,
    requestId,
    videoUrl: json.video?.url,
    durationSeconds: json.video?.duration,
    model: json.model,
    errorCode: json.error?.code ?? null,
    errorMessage: json.error?.message ?? null
  };
}

/**
 * Step 2 (loop): poll /v1/videos/{request_id} until done / failed / expired,
 * or the pollTimeoutMs budget is exhausted (in which case we throw
 * GrokVideoTimeoutError so the caller can persist the request_id for
 * later resumption).
 */
export async function grokAwaitVideo(
  requestId: string,
  opts: { pollTimeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<GrokVideoCompleteResult> {
  const deadline = Date.now() + (opts.pollTimeoutMs ?? 50_000);
  const interval = Math.max(1000, opts.pollIntervalMs ?? 3000);

  for (;;) {
    const result = await grokPollVideoOnce(requestId);

    if (result.status === 'done') {
      if (!result.videoUrl) {
        throw new GrokApiError(502, 'xAI returned status=done with no video.url');
      }
      const duration = result.durationSeconds ?? 0;
      return {
        videoUrl: result.videoUrl,
        durationSeconds: duration,
        revisedPrompt: undefined,
        model: result.model ?? DEFAULT_VIDEO_MODEL,
        requestId,
        costUsd: estimateVideoCostUsd(duration)
      };
    }

    if (result.status === 'failed' || result.status === 'expired') {
      throw new GrokVideoFailedError(
        requestId,
        result.errorCode ?? null,
        result.errorMessage ?? `video ${result.status}`
      );
    }

    if (Date.now() >= deadline) {
      throw new GrokVideoTimeoutError(requestId);
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Convenience: start + await in one call. The caller still benefits from
 * GrokVideoTimeoutError carrying the request_id when the poll budget elapses
 * before the job finishes, which lets the orchestrator persist the row with
 * status='running' and resume the poll on a later GET.
 */
export async function grokGenerateVideo(req: GrokVideoRequest): Promise<GrokVideoCompleteResult> {
  const start = await grokStartVideo(req);
  return grokAwaitVideo(start.requestId, {
    pollTimeoutMs: req.pollTimeoutMs,
    pollIntervalMs: req.pollIntervalMs
  });
}
