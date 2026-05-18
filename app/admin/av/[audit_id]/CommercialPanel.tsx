'use client';
import { useCallback, useEffect, useState } from 'react';

/**
 * CommercialPanel
 *
 * The "Commercials" tab on the lead detail page. Owner + staff only.
 *
 * Three things this UI does:
 *   1. Generate a new image / video commercial via Grok Imagine.
 *   2. List existing assets for the lead with download + delete.
 *   3. Show real upstream errors so 502s self-explain (no more digging
 *      through System Events to learn the API key is wrong).
 *
 * Image generation completes synchronously (~5-15s). Video generation
 * may return generationStatus='running'; the panel auto-polls every 5s
 * until the asset settles.
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

interface ErrorDetail {
  message: string;
  hint?: string;
}

const IMAGE_MODEL_OPTIONS: { value: ImageModel; label: string; cost: string }[] = [
  { value: 'grok-imagine-image-quality', label: 'Quality (recommended)', cost: 'standard rate' },
  { value: 'grok-imagine-image', label: 'Fast', cost: 'lower rate' },
  { value: 'grok-imagine-image-pro', label: 'Pro (deprecated)', cost: 'premium rate' }
];

const ASPECT_RATIO_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: '16:9', label: '16:9 widescreen' },
  { value: '9:16', label: '9:16 vertical (Reels / TikTok)' },
  { value: '1:1', label: '1:1 square (feed)' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4 portrait' }
];

function statusGlow(s: GenerationStatus): string {
  switch (s) {
    case 'succeeded':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30';
    case 'running':
    case 'queued':
      return 'bg-amber-500/20 text-amber-200 border-amber-400/30 animate-pulse';
    case 'failed':
      return 'bg-red-500/20 text-red-300 border-red-400/30';
  }
}

function shortPrompt(s: string, max = 140): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, '') + '...';
}

/**
 * Translate a raw API error message into something humans understand,
 * with an optional hint for fixing it.
 */
function explainError(raw: string): ErrorDetail {
  const m = raw.toLowerCase();
  if (m.includes('xai_api_key') && m.includes('not configured')) {
    return {
      message: 'xAI API key is not set in Netlify.',
      hint: 'Add XAI_API_KEY to https://app.netlify.com/sites/atlantic-hub/configuration/env then trigger a redeploy.'
    };
  }
  if (m.includes('incorrect api key') || m.includes('invalid api key')) {
    return {
      message: 'xAI rejected the API key.',
      hint: 'In Netlify env vars, confirm XAI_API_KEY starts with "xai-" (not "sk-" or "OJ"). Re-paste a fresh key from console.x.ai then trigger a redeploy.'
    };
  }
  if (m.includes('billing') || m.includes('quota') || m.includes('insufficient')) {
    return {
      message: 'xAI billing or quota issue.',
      hint: 'Add credit at https://console.x.ai/team/default/billing then retry.'
    };
  }
  if (m.includes('rate limit') || m.includes('429')) {
    return {
      message: 'xAI rate limit hit.',
      hint: 'Wait 30 seconds and try again. Bump your xAI tier if this keeps happening.'
    };
  }
  if (m.includes('502') || m.includes('xai api error')) {
    return {
      message: raw,
      hint: 'Open System Events for the full upstream payload.'
    };
  }
  return { message: raw };
}

export function CommercialPanel({
  auditId,
  initialPrompt = '',
  initialAssetType = 'image'
}: {
  auditId: string;
  initialPrompt?: string;
  initialAssetType?: AssetType;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [assetType, setAssetType] = useState<AssetType>(initialAssetType);
  const [imageModel, setImageModel] = useState<ImageModel>('grok-imagine-image-quality');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [resolution, setResolution] = useState<ResolutionTier>('1k');
  const [durationSeconds, setDurationSeconds] = useState(6);
  const [customPrompt, setCustomPrompt] = useState(initialPrompt);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<ErrorDetail | null>(null);
  const [justSparkled, setJustSparkled] = useState(false);

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
    const running = assets.some(
      (a) => a.generationStatus === 'running' || a.generationStatus === 'queued'
    );
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
      const body: Record<string, unknown> = { assetType, resolution, aspectRatio };
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
        // The route returns { error, detail?, code? } -- combine them so the human sees the upstream message.
        const parts: string[] = [];
        if (json.error) parts.push(String(json.error));
        if (json.detail) parts.push(String(json.detail));
        if (json.code) parts.push(`code=${String(json.code)}`);
        throw new Error(parts.join(' -- ') || `HTTP ${res.status}`);
      }
      setCustomPrompt('');
      setJustSparkled(true);
      window.setTimeout(() => setJustSparkled(false), 2200);
      await fetchAssets();
    } catch (err) {
      setGenerateError(explainError((err as Error).message));
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(assetId: number) {
    if (!confirm('Delete this commercial? It will be soft-archived.')) return;
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
      {/* Generator card */}
      <div className="relative bg-surface border border-border rounded-2xl p-6 overflow-hidden">
        {/* Decorative gradient flourish */}
        <div className="pointer-events-none absolute -top-24 -right-24 w-64 h-64 rounded-full opacity-20 blur-3xl"
             style={{ background: 'linear-gradient(135deg, #FF5A6E 0%, #FFC73D 100%)' }} />
        <div className="pointer-events-none absolute -bottom-20 -left-24 w-56 h-56 rounded-full opacity-15 blur-3xl"
             style={{ background: 'linear-gradient(135deg, #8338EC 0%, #FF9C5B 100%)' }} />

        {/* Header */}
        <div className="relative flex items-baseline gap-3 mb-1">
          <span className="text-2xl" aria-hidden>🎬</span>
          <h3 className="text-xl font-semibold tracking-tight text-ink">
            Make a{' '}
            <span
              className="font-bold italic"
              style={{
                background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 50%, #FFC73D 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent'
              }}
            >
              commercial
            </span>
            {justSparkled && (
              <span className="inline-block ml-2 animate-bounce" aria-hidden>
                ✨
              </span>
            )}
          </h3>
        </div>
        <p className="relative text-sm text-muted mb-5">
          AI-generated, on-brand for this lead. Image lands in seconds; video usually 30s-2min.
        </p>

        <div className="relative grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-1.5">
              Asset type
            </label>
            <div className="inline-flex rounded-full border border-border overflow-hidden p-0.5 bg-bg">
              <button
                type="button"
                onClick={() => setAssetType('image')}
                className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all ${
                  assetType === 'image'
                    ? 'bg-gradient-to-r from-pink-500 to-orange-400 text-white shadow-lg shadow-pink-500/20'
                    : 'text-muted hover:text-ink'
                }`}
              >
                Image
              </button>
              <button
                type="button"
                onClick={() => setAssetType('video')}
                className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all ${
                  assetType === 'video'
                    ? 'bg-gradient-to-r from-pink-500 to-orange-400 text-white shadow-lg shadow-pink-500/20'
                    : 'text-muted hover:text-ink'
                }`}
              >
                Video
              </button>
            </div>
          </div>

          {assetType === 'image' ? (
            <div>
              <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-1.5">
                Image model
              </label>
              <select
                value={imageModel}
                onChange={(e) => setImageModel(e.target.value as ImageModel)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white"
              >
                {IMAGE_MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-1.5">
                Duration (seconds)
              </label>
              <input
                type="number"
                min={1}
                max={15}
                value={durationSeconds}
                onChange={(e) =>
                  setDurationSeconds(Math.min(15, Math.max(1, Number(e.target.value) || 6)))
                }
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white"
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-1.5">
              Aspect ratio
            </label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white"
            >
              {ASPECT_RATIO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-1.5">
              Resolution tier
            </label>
            <div className="inline-flex rounded-full border border-border overflow-hidden p-0.5 bg-bg">
              <button
                type="button"
                onClick={() => setResolution('1k')}
                className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all ${
                  resolution === '1k'
                    ? 'bg-gradient-to-r from-pink-500 to-orange-400 text-white shadow-lg shadow-pink-500/20'
                    : 'text-muted hover:text-ink'
                }`}
              >
                Standard
              </button>
              <button
                type="button"
                onClick={() => setResolution('2k')}
                className={`px-4 py-1.5 text-sm font-medium rounded-full transition-all ${
                  resolution === '2k'
                    ? 'bg-gradient-to-r from-pink-500 to-orange-400 text-white shadow-lg shadow-pink-500/20'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {assetType === 'video' ? 'HD' : 'High Res'}
              </button>
            </div>
          </div>
        </div>

        <div className="relative mt-4">
          <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-1.5">
            Custom prompt (optional) -- leave blank to auto-build from this lead&apos;s visual brief
          </label>
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="e.g. Sun-drenched hero shot of an artisan coffee bar in soft morning light, steam rising, warm wood and brass accents..."
            rows={3}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white"
            maxLength={4000}
          />
          <div className="text-[11px] text-muted mt-1">{customPrompt.length} / 4000</div>
        </div>

        <div className="relative mt-4 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="relative px-6 py-2.5 rounded-full text-white text-sm font-semibold inline-flex items-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 50%, #FFC73D 100%)',
              boxShadow: '0 12px 28px -8px rgba(255,90,110,0.45)'
            }}
          >
            {generating ? (
              <>
                <span className="inline-block animate-spin">◐</span> Generating{assetType === 'video' ? ' video...' : '...'}
              </>
            ) : (
              <>
                <span>✨</span> Generate {assetType}
              </>
            )}
          </button>
        </div>

        {/* Detailed error card -- shows upstream xAI message + a hint */}
        {generateError && (
          <div className="relative mt-4 rounded-xl border border-red-400/40 bg-red-500/10 p-4">
            <div className="flex items-start gap-3">
              <span className="text-red-300 text-lg leading-none mt-0.5" aria-hidden>!</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-red-100 mb-1">Couldn&apos;t generate</div>
                <div className="text-xs text-red-100/90 whitespace-pre-wrap break-words leading-relaxed">
                  {generateError.message}
                </div>
                {generateError.hint && (
                  <div className="mt-3 text-xs text-amber-100 bg-amber-500/10 border border-amber-400/30 rounded-lg p-2.5">
                    <strong>Try this:</strong> {generateError.hint}
                  </div>
                )}
                <div className="mt-2 text-[10px] text-muted">
                  Full payload also visible in{' '}
                  <a className="underline" href="/admin/events" target="_blank" rel="noopener noreferrer">
                    System Events
                  </a>
                  .
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGenerateError(null)}
                className="text-red-200/60 hover:text-red-100 text-lg leading-none px-1"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Asset library */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-ink flex items-center gap-2">
            <span className="text-lg" aria-hidden>📁</span>
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
          <div className="relative px-6 py-16 text-center bg-surface border border-border rounded-2xl overflow-hidden">
            <div className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full opacity-10 blur-3xl"
                 style={{ background: 'linear-gradient(135deg, #FF5A6E, #FFC73D)' }} />
            <div className="relative text-5xl mb-3 animate-pulse" aria-hidden>✨</div>
            <p className="relative text-base font-medium text-ink">Nothing yet -- be the spark.</p>
            <p className="relative text-sm text-muted mt-1">
              Click <strong>Generate</strong> above. First commercial is on the house.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assets.map((asset) => (
              <AssetCard
                key={asset.assetId}
                asset={asset}
                onDelete={() => handleDelete(asset.assetId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetCard({ asset, onDelete }: { asset: Asset; onDelete: () => void }) {
  const isRunning =
    asset.generationStatus === 'running' || asset.generationStatus === 'queued';

  return (
    <div className="group bg-surface border border-border rounded-2xl overflow-hidden flex flex-col transition-all hover:border-pink-400/40 hover:shadow-xl hover:shadow-pink-500/5 hover:-translate-y-0.5">
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
            <div className="inline-block text-amber-300 text-3xl animate-pulse">◐</div>
            <p className="text-xs text-muted mt-3 max-w-xs">
              {asset.assetType === 'video'
                ? 'Rendering on xAI -- 30s to a few minutes.'
                : 'Generating...'}
            </p>
          </div>
        ) : (
          <div className="text-center px-4">
            <div className="text-red-300 text-3xl">!</div>
            <p className="text-xs text-muted mt-2 max-w-xs break-words">
              {asset.errorMessage || 'Failed'}
            </p>
          </div>
        )}

        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur text-[10px] uppercase tracking-[0.12em] text-white font-medium">
          {asset.assetType}
          {asset.durationSeconds ? ` · ${asset.durationSeconds}s` : ''}
        </div>
        <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-full backdrop-blur text-[10px] uppercase tracking-[0.12em] border ${statusGlow(asset.generationStatus)}`}>
          {asset.generationStatus}
        </div>
      </div>

      <div className="p-3 flex-1 flex flex-col gap-2">
        <p className="text-xs text-ink leading-relaxed">{shortPrompt(asset.prompt)}</p>
        <div className="text-[10px] text-muted flex flex-wrap gap-x-3 gap-y-1">
          <span>{asset.model}</span>
          <span>{asset.resolutionTier.toUpperCase()}</span>
          {asset.aspectRatio && <span>{asset.aspectRatio}</span>}
          <span>{new Date(asset.createdAt).toLocaleString()}</span>
        </div>

        <div className="flex items-center gap-2 mt-1">
          {asset.url ? (
            <a
              href={asset.url}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="px-3 py-1.5 rounded-full border border-border text-xs hover:border-pink-400 text-ink transition-colors"
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
              className="px-3 py-1.5 rounded-full border border-border text-xs text-muted hover:text-ink hover:border-pink-400 transition-colors"
            >
              Copy URL
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto px-3 py-1.5 rounded-full border border-border text-xs text-muted hover:text-red-400 hover:border-red-400/60 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
