'use client';
import { useCallback, useEffect, useState } from 'react';

/**
 * CommercialPanel
 *
 * UI for the "Commercials" tab on the lead detail page. Lists generated
 * Grok Imagine assets for this lead, lets owner/staff kick off a new image
 * or video commercial, and exposes download + (owner-only) delete.
 *
 * Image generation completes synchronously (~5-15s).
 * Video generation may return generationStatus='running' if the upstream
 * job has not finished within the route's 50-second poll budget. In that
 * case the panel polls GET /commercial/[asset_id] every 5s until either
 * 'succeeded' or 'failed'.
 */

type GenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed';
type AssetType = 'image' | 'video';
type ResolutionTier = '1k' | '2k';
type ImageModel =
  | 'grok-imagine-image'
  | 'grok-imagine-image-quality'
  | 'grok-imagine-image-pro';
type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3';

interface Asset {
  assetId: number;
  assetType: AssetType;
  model: string;
  url: string | null;
  costUsd: number | null;
  generationStatus: GenerationStatus;
  durationSeconds: number | null;
  resolutionTier: ResolutionTier;
  aspectRatio: string | null;
  prompt: string;
  enhancedPrompt: string | null;
  errorMessage: string | null;
  providerRequestId: string | null;
  createdAt: string;
  completedAt: string | null;
}

const IMAGE_MODEL_OPTIONS: { value: ImageModel; label: string; cost: string }[] = [
  { value: 'grok-imagine-image-quality', label: 'Quality (recommended)', cost: '$0.05 / image' },
  { value: 'grok-imagine-image', label: 'Standard (fastest, cheapest)', cost: '$0.02 / image' },
  { value: 'grok-imagine-image-pro', label: 'Pro (deprecated 2026-05-15)', cost: '$0.07 / image' }
];

const ASPECT_RATIO_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: '16:9', label: '16:9 widescreen' },
  { value: '9:16', label: '9:16 vertical (reels)' },
  { value: '1:1', label: '1:1 square' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4 portrait' }
];

function formatCost(c: number | null): string {
  if (c == null) return '--';
  return `$${c.toFixed(2)}`;
}

function statusColor(s: GenerationStatus): string {
  switch (s) {
    case 'succeeded':
      return 'text-emerald-300';
    case 'running':
    case 'queued':
      return 'text-amber-300';
    case 'failed':
      return 'text-red-300';
  }
}

function shortPrompt(s: string, max = 140): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, '') + '...';
}

export function CommercialPanel({ auditId }: { auditId: string }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Generate form state
  const [assetType, setAssetType] = useState<AssetType>('image');
  const [imageModel, setImageModel] = useState<ImageModel>('grok-imagine-image-quality');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [resolution, setResolution] = useState<ResolutionTier>('1k');
  const [durationSeconds, setDurationSeconds] = useState(6);
  const [customPrompt, setCustomPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const fetchAssets = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/commercial`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { assets: Asset[] };
      setAssets(j.assets);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [auditId]);

  useEffect(() => {
    void fetchAssets();
  }, [fetchAssets]);

  // Auto-poll any 'running' assets every 5s until they settle.
  useEffect(() => {
    const running = assets.some((a) => a.generationStatus === 'running' || a.generationStatus === 'queued');
    if (!running) return;

    const handle = setInterval(() => {
      void fetchAssets();
    }, 5000);
    return () => clearInterval(handle);
  }, [assets, fetchAssets]);

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const body: Record<string, unknown> = {
        assetType,
        resolution,
        aspectRatio
      };
      if (customPrompt.trim().length > 0) body.customPrompt = customPrompt.trim();
      if (assetType === 'image') {
        body.imageModel = imageModel;
      } else {
        body.durationSeconds = durationSeconds;
      }
      const res = await fetch(`/api/admin/av/leads/${auditId}/commercial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const rawText = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(rawText);
      } catch {
        throw new Error(`Server returned non-JSON (HTTP ${res.status}). First 200 chars: ${rawText.slice(0, 200)}`);
      }
      if (!res.ok) {
        throw new Error(
          (json.error as string | undefined) ||
            (json.detail as string | undefined) ||
            `HTTP ${res.status}`
        );
      }
      // Refresh the list. The new asset will appear at the top.
      setCustomPrompt('');
      await fetchAssets();
    } catch (err) {
      setGenerateError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(assetId: number) {
    if (!confirm('Delete this commercial? It will be soft-archived (recoverable in DB).')) return;
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/commercial/${assetId}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      await fetchAssets();
    } catch (err) {
      alert(`Delete failed: ${(err as Error).message}`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-surface border border-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">🎬</span>
          <h3 className="text-base font-semibold text-ink">Generate a new commercial</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-1.5">
              Asset type
            </label>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setAssetType('image')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  assetType === 'image'
                    ? 'bg-brand text-white'
                    : 'bg-surface text-muted hover:text-ink'
                }`}
              >
                Image
              </button>
              <button
                type="button"
                onClick={() => setAssetType('video')}
                className={`px-4 py-2 text-sm font-medium transition-colors border-l border-border ${
                  assetType === 'video'
                    ? 'bg-brand text-white'
                    : 'bg-surface text-muted hover:text-ink'
                }`}
              >
                Video
              </button>
            </div>
          </div>

          {assetType === 'image' ? (
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted mb-1.5">
                Image model
              </label>
              <select
                value={imageModel}
                onChange={(e) => setImageModel(e.target.value as ImageModel)}
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-white"
              >
                {IMAGE_MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} -- {opt.cost}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted mb-1.5">
                Duration (seconds) -- $0.05 / sec
              </label>
              <input
                type="number"
                min={1}
                max={15}
                value={durationSeconds}
                onChange={(e) =>
                  setDurationSeconds(Math.min(15, Math.max(1, Number(e.target.value) || 6)))
                }
                className="w-full border border-border rounded-md px-3 py-2 text-sm bg-white"
              />
            </div>
          )}

          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-1.5">
              Aspect ratio
            </label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-white"
            >
              {ASPECT_RATIO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-1.5">
              Resolution tier
            </label>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setResolution('1k')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  resolution === '1k'
                    ? 'bg-brand text-white'
                    : 'bg-surface text-muted hover:text-ink'
                }`}
              >
                1K
              </button>
              <button
                type="button"
                onClick={() => setResolution('2k')}
                className={`px-4 py-2 text-sm font-medium transition-colors border-l border-border ${
                  resolution === '2k'
                    ? 'bg-brand text-white'
                    : 'bg-surface text-muted hover:text-ink'
                }`}
              >
                {assetType === 'video' ? '720p (2K tier)' : '2K'}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-xs uppercase tracking-wider text-muted mb-1.5">
            Custom prompt (optional) -- leave blank to auto-build from the lead&apos;s audit + industry
          </label>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="e.g. Sun-drenched hero shot of an artisan coffee bar in soft morning light, steam rising from a fresh pour, warm wood and brass accents, premium magazine-cover styling."
            rows={3}
            className="w-full border border-border rounded-md px-3 py-2 text-sm bg-white"
            maxLength={4000}
          />
          <div className="text-[11px] text-muted mt-1">{customPrompt.length} / 4000</div>
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="px-5 py-2 rounded-md bg-brand text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {generating ? (
              <>
                <span className="animate-pulse">●</span> Generating{assetType === 'video' ? ' video (may take ~1 min)' : ''}...
              </>
            ) : (
              <>
                <span>✨</span> Generate {assetType}
              </>
            )}
          </button>
          {generateError && (
            <span className="text-xs text-red-400 max-w-md">Error: {generateError}</span>
          )}
          <span className="text-xs text-muted">
            Estimated cost:{' '}
            <strong className="text-ink">
              {assetType === 'image'
                ? formatCost(
                    imageModel === 'grok-imagine-image-pro'
                      ? 0.07
                      : imageModel === 'grok-imagine-image-quality'
                      ? 0.05
                      : 0.02
                  )
                : formatCost(0.05 * durationSeconds)}
            </strong>
          </span>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-ink">
            Generated commercials{' '}
            <span className="text-muted font-normal">({assets.length})</span>
          </h3>
          <button
            type="button"
            onClick={() => void fetchAssets()}
            className="text-xs text-muted hover:text-ink transition-colors"
          >
            Refresh
          </button>
        </div>

        {loadError && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200 mb-3">
            {loadError}
          </div>
        )}

        {!loaded ? (
          <p className="text-sm text-muted">Loading...</p>
        ) : assets.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted bg-surface border border-border rounded-lg">
            No commercials generated for this lead yet. Hit <strong>Generate</strong> above to make
            the first one.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assets.map((asset) => (
              <AssetCard key={asset.assetId} asset={asset} onDelete={() => handleDelete(asset.assetId)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetCard({ asset, onDelete }: { asset: Asset; onDelete: () => void }) {
  const isRunning = asset.generationStatus === 'running' || asset.generationStatus === 'queued';
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col">
      <div className="aspect-video bg-black flex items-center justify-center relative">
        {asset.url ? (
          asset.assetType === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.url}
              alt={shortPrompt(asset.prompt, 80)}
              className="w-full h-full object-cover"
            />
          ) : (
            <video
              src={asset.url}
              controls
              preload="metadata"
              className="w-full h-full object-contain bg-black"
            />
          )
        ) : isRunning ? (
          <div className="text-center px-4">
            <div className="text-amber-300 text-2xl animate-pulse">●</div>
            <p className="text-xs text-muted mt-2">
              {asset.assetType === 'video'
                ? 'Video rendering on xAI -- this usually takes 30s to a few minutes.'
                : 'Generating...'}
            </p>
          </div>
        ) : (
          <div className="text-center px-4">
            <div className="text-red-300 text-2xl">!</div>
            <p className="text-xs text-muted mt-2">{asset.errorMessage || 'Failed'}</p>
          </div>
        )}

        <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur text-[10px] uppercase tracking-wider text-white">
          {asset.assetType}
          {asset.durationSeconds ? ` · ${asset.durationSeconds}s` : ''}
        </div>
        <div className={`absolute top-2 right-2 px-2 py-0.5 rounded bg-black/70 backdrop-blur text-[10px] uppercase tracking-wider ${statusColor(asset.generationStatus)}`}>
          {asset.generationStatus}
        </div>
      </div>

      <div className="p-3 flex-1 flex flex-col gap-2">
        <p className="text-xs text-ink leading-relaxed">{shortPrompt(asset.prompt)}</p>
        <div className="text-[11px] text-muted flex flex-wrap gap-x-3 gap-y-1">
          <span>{asset.model}</span>
          <span>{asset.resolutionTier.toUpperCase()}</span>
          {asset.aspectRatio && <span>{asset.aspectRatio}</span>}
          <span>{formatCost(asset.costUsd)}</span>
          <span>{new Date(asset.createdAt).toLocaleString()}</span>
        </div>

        <div className="flex items-center gap-2 mt-1">
          {asset.url ? (
            <a
              href={asset.url}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="px-3 py-1.5 rounded-md border border-border text-xs hover:border-brand text-ink transition-colors"
            >
              Download
            </a>
          ) : null}
          {asset.url ? (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(asset.url!);
              }}
              className="px-3 py-1.5 rounded-md border border-border text-xs text-muted hover:text-ink hover:border-brand transition-colors"
            >
              Copy URL
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto px-3 py-1.5 rounded-md border border-border text-xs text-muted hover:text-red-400 hover:border-red-400/60 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
