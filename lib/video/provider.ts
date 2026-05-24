/**
 * lib/video/provider.ts
 *
 * Vendor-neutral image/video generation provider seam. Mirrors the swappable
 * StorageProvider pattern (lib/storage/provider.ts) so we are never locked to
 * one AI media vendor.
 *
 * The orchestrator (lib/grok/discoverer.ts) and any caller talk ONLY to the
 * VideoProvider interface + the neutral error/types below. To switch vendors
 * (e.g. drop Grok for another video model), implement VideoProvider for the
 * new vendor, register it in getVideoProvider(), and set VIDEO_PROVIDER --
 * no caller changes required.
 *
 * Today the only implementation is GrokVideoProvider, which delegates to
 * lib/grok/imagine and translates Grok-specific errors into the neutral ones
 * below so callers never depend on a vendor's error classes.
 */
import {
  grokGenerateImage,
  grokStartVideo,
  grokAwaitVideo,
  grokPollVideoOnce,
  estimateImageCostUsd as grokEstimateImageCostUsd,
  estimateVideoCostUsd as grokEstimateVideoCostUsd,
  GrokApiKeyMissingError,
  GrokApiError,
  GrokVideoTimeoutError,
  GrokVideoFailedError,
  type GrokImageModel,
  type GrokResolutionTier,
  type GrokAspectRatio
} from '@/lib/grok/imagine';

// ---------------------------------------------------------------------
// Neutral types (provider-agnostic). Model identifiers stay free-form
// strings because they are inherently vendor-specific.
// ---------------------------------------------------------------------

export type VideoResolutionTier = '1k' | '2k';
export type VideoAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3';

export interface ProviderImageRequest {
  prompt: string;
  model?: string;
  resolution?: VideoResolutionTier;
  aspectRatio?: VideoAspectRatio;
  n?: number;
}

export interface ProviderImageResult {
  imageUrl: string;
  base64?: string;
  revisedPrompt?: string;
  model: string;
  costUsd: number;
}

export interface ProviderVideoRequest {
  prompt: string;
  model?: string;
  durationSeconds?: number;
  resolution?: VideoResolutionTier;
  aspectRatio?: VideoAspectRatio;
}

export interface ProviderVideoStart {
  jobId: string;
  model: string;
  costUsd: number;
}

export interface ProviderVideoStatus {
  status: 'pending' | 'done' | 'failed' | 'expired';
  jobId: string;
  videoUrl?: string;
  durationSeconds?: number;
  model?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface ProviderVideoComplete {
  videoUrl: string;
  durationSeconds: number;
  revisedPrompt?: string;
  model: string;
  jobId: string;
  costUsd: number;
}

// ---------------------------------------------------------------------
// Neutral errors. The orchestrator branches on THESE, never on a vendor's.
// ---------------------------------------------------------------------

export class VideoProviderKeyMissingError extends Error {
  constructor(message = 'Video provider API key is not configured') {
    super(message);
    this.name = 'VideoProviderKeyMissingError';
  }
}

export class VideoProviderError extends Error {
  /** HTTP-ish status when the vendor surfaced one (e.g. 429 = rate limited). */
  status: number | null;
  body: string;
  constructor(status: number | null, body: string) {
    super(`Video provider error ${status ?? ''}: ${body.slice(0, 200)}`);
    this.name = 'VideoProviderError';
    this.status = status;
    this.body = body;
  }
}

export class VideoTimeoutError extends Error {
  jobId: string;
  constructor(jobId: string) {
    super(`Video generation did not complete within the poll budget (jobId=${jobId})`);
    this.name = 'VideoTimeoutError';
    this.jobId = jobId;
  }
}

export class VideoFailedError extends Error {
  jobId: string;
  code: string | null;
  constructor(jobId: string, code: string | null, message: string) {
    super(`Video generation failed (jobId=${jobId}, code=${code}): ${message}`);
    this.name = 'VideoFailedError';
    this.jobId = jobId;
    this.code = code;
  }
}

// ---------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------

export interface VideoProvider {
  readonly name: string;
  generateImage(req: ProviderImageRequest): Promise<ProviderImageResult[]>;
  startVideo(req: ProviderVideoRequest): Promise<ProviderVideoStart>;
  pollVideoOnce(jobId: string): Promise<ProviderVideoStatus>;
  awaitVideo(jobId: string, opts?: { pollTimeoutMs?: number; pollIntervalMs?: number }): Promise<ProviderVideoComplete>;
  estimateImageCostUsd(model: string, n: number): number;
  estimateVideoCostUsd(durationSeconds: number): number;
}

// ---------------------------------------------------------------------
// Grok implementation -- delegates + translates errors to neutral ones.
// ---------------------------------------------------------------------

/** Wrap a vendor call, translating Grok errors into neutral provider errors. */
async function translateGrokErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GrokApiKeyMissingError) throw new VideoProviderKeyMissingError(err.message);
    if (err instanceof GrokVideoTimeoutError) throw new VideoTimeoutError(err.requestId);
    if (err instanceof GrokVideoFailedError) throw new VideoFailedError(err.requestId, err.code, err.message);
    if (err instanceof GrokApiError) throw new VideoProviderError(err.status, err.body);
    throw err;
  }
}

export class GrokVideoProvider implements VideoProvider {
  readonly name = 'grok';

  async generateImage(req: ProviderImageRequest): Promise<ProviderImageResult[]> {
    return translateGrokErrors(() =>
      grokGenerateImage({
        prompt: req.prompt,
        model: req.model as GrokImageModel | undefined,
        resolution: req.resolution as GrokResolutionTier | undefined,
        aspectRatio: req.aspectRatio as GrokAspectRatio | undefined,
        n: req.n
      })
    );
  }

  async startVideo(req: ProviderVideoRequest): Promise<ProviderVideoStart> {
    const r = await translateGrokErrors(() =>
      grokStartVideo({
        prompt: req.prompt,
        durationSeconds: req.durationSeconds,
        resolution: req.resolution as GrokResolutionTier | undefined,
        aspectRatio: req.aspectRatio as GrokAspectRatio | undefined
      })
    );
    return { jobId: r.requestId, model: r.model, costUsd: r.costUsd };
  }

  async pollVideoOnce(jobId: string): Promise<ProviderVideoStatus> {
    const r = await translateGrokErrors(() => grokPollVideoOnce(jobId));
    return {
      status: r.status,
      jobId: r.requestId,
      videoUrl: r.videoUrl,
      durationSeconds: r.durationSeconds,
      model: r.model,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage
    };
  }

  async awaitVideo(
    jobId: string,
    opts?: { pollTimeoutMs?: number; pollIntervalMs?: number }
  ): Promise<ProviderVideoComplete> {
    const r = await translateGrokErrors(() => grokAwaitVideo(jobId, opts ?? {}));
    return {
      videoUrl: r.videoUrl,
      durationSeconds: r.durationSeconds,
      revisedPrompt: r.revisedPrompt,
      model: r.model,
      jobId: r.requestId,
      costUsd: r.costUsd
    };
  }

  estimateImageCostUsd(model: string, n: number): number {
    return grokEstimateImageCostUsd(model as GrokImageModel, n);
  }

  estimateVideoCostUsd(durationSeconds: number): number {
    return grokEstimateVideoCostUsd(durationSeconds);
  }
}

// ---------------------------------------------------------------------
// Factory -- VIDEO_PROVIDER selects the implementation (default: grok).
// ---------------------------------------------------------------------

let cached: VideoProvider | null = null;

export function getVideoProvider(): VideoProvider {
  if (cached) return cached;
  const name = (process.env.VIDEO_PROVIDER || 'grok').toLowerCase();
  switch (name) {
    // case 'newvendor': cached = new NewVendorVideoProvider(); break;
    case 'grok':
    default:
      cached = new GrokVideoProvider();
  }
  return cached;
}
