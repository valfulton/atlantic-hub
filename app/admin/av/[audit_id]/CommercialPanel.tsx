'use client';
import { useCallback, useEffect, useState } from 'react';
import { BrandKitPanel } from './BrandKitPanel';

/**
 * CommercialPanel
 *
 * The "Commercials" tab on the lead detail page. Owner + staff only.
 *
 * What this UI does:
 *   1. Generate a new image / video commercial via the AI engine.
 *   2. Let the operator preview + EDIT the auto-built prompt before
 *      sending it (no more invisible-prompt surprises).
 *   3. Offer a logo-space corner so the model leaves clean negative
 *      space for a post-production logo overlay.
 *   4. List existing assets with download + delete.
 *   5. Show real upstream errors with a plain-English explanation +
 *      a fix-it hint, so a misconfigured API key self-diagnoses.
 *
 * Brand etiquette: per CLIENT_FACING_GUARDRAILS.md and Val's request,
 * no third-party provider / model brand names appear in admin-facing
 * copy. We use "Quality / Fast / Pro" labels rather than the raw
 * model strings.
 */

type GenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed';
type AssetType = 'image' | 'video';
type ResolutionTier = '1k' | '2k';
type ImageModel =
  | 'grok-imagine-image'
  | 'grok-imagine-image-quality'
  | 'grok-imagine-image-pro';
type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3';
type LogoSpace = 'none' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

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

interface SocialDraft {
  id: number;
  platform: 'linkedin' | 'twitter' | 'instagram' | 'facebook' | 'threads' | 'tiktok' | 'other';
  variant: string | null;
  body: string;
  charCount: number | null;
  status: 'active' | 'used_for_commercial' | 'published' | 'archived';
  commercialAssetId: number | null;
  createdAt: string;
}

const PLATFORM_LABEL: Record<SocialDraft['platform'], string> = {
  linkedin: 'LinkedIn',
  twitter: 'X / Twitter',
  instagram: 'Instagram',
  facebook: 'Facebook',
  threads: 'Threads',
  tiktok: 'TikTok',
  other: 'Other'
};

/** Map a draft platform to the best-fit aspect ratio for the commercial. */
function aspectForPlatform(p: SocialDraft['platform']): AspectRatio {
  if (p === 'linkedin') return '16:9';
  if (p === 'instagram' || p === 'tiktok' || p === 'threads') return '9:16';
  return '16:9';
}

const IMAGE_MODEL_OPTIONS: { value: ImageModel; label: string; sub: string }[] = [
  { value: 'grok-imagine-image-quality', label: 'Quality', sub: 'Recommended for hero shots' },
  { value: 'grok-imagine-image', label: 'Fast', sub: 'Quicker drafts, lower fidelity' },
  { value: 'grok-imagine-image-pro', label: 'Pro', sub: 'Premium look (legacy)' }
];

const ASPECT_RATIO_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: '16:9', label: '16:9 widescreen' },
  { value: '9:16', label: '9:16 vertical (Reels / TikTok)' },
  { value: '1:1', label: '1:1 square (feed)' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4 portrait' }
];

const LOGO_SPACE_OPTIONS: { value: LogoSpace; label: string }[] = [
  { value: 'none', label: 'No reserved space' },
  { value: 'top-left', label: 'Top-left corner' },
  { value: 'top-right', label: 'Top-right corner' },
  { value: 'bottom-left', label: 'Bottom-left corner' },
  { value: 'bottom-right', label: 'Bottom-right corner' }
];

/** Friendly label for a stored model string (no provider brand visible). */
function friendlyModelLabel(model: string): string {
  if (model.includes('quality')) return 'Quality';
  if (model.includes('pro')) return 'Pro';
  if (model.includes('image')) return 'Standard';
  if (model.includes('video')) return 'Video';
  return 'AI';
}

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

/** Translate raw upstream errors into operator-friendly messages + a hint. */
function explainError(raw: string): ErrorDetail {
  const m = raw.toLowerCase();
  if (m.includes('api_key') && m.includes('not configured')) {
    return {
      message: 'AI engine API key is not set in Netlify.',
      hint: 'Add XAI_API_KEY in https://app.netlify.com/sites/atlantic-hub/configuration/env then trigger a redeploy.'
    };
  }
  if (m.includes('incorrect api key') || m.includes('invalid api key')) {
    return {
      message: 'AI engine rejected the API key.',
      hint: 'Re-paste a fresh API key into Netlify env var XAI_API_KEY, then trigger a redeploy.'
    };
  }
  if (m.includes('billing') || m.includes('quota') || m.includes('insufficient')) {
    return {
      message: 'AI engine billing or quota issue.',
      hint: 'Top up credits on the provider console then retry.'
    };
  }
  if (m.includes('rate limit') || m.includes('429')) {
    return {
      message: 'AI engine rate limit hit.',
      hint: 'Wait 30 seconds and retry. Bump the AI engine tier if this keeps happening.'
    };
  }
  if (m.includes('502') || m.includes('api error')) {
    return {
      message: raw,
      hint: 'Open System Events for the full upstream payload.'
    };
  }
  return { message: raw };
}

// Shared class strings so inputs are visible on every theme.
const INPUT_CLASS =
  'w-full border border-border rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-400';
const TEXTAREA_CLASS = `${INPUT_CLASS} leading-relaxed`;
const SELECT_CLASS = INPUT_CLASS;

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
  const [logoSpace, setLogoSpace] = useState<LogoSpace>('bottom-right');
  const [customPrompt, setCustomPrompt] = useState(initialPrompt);
  const [promptSource, setPromptSource] = useState<'manual' | 'visual_brief' | 'audit' | 'fallback' | null>(
    initialPrompt ? 'manual' : null
  );
  const [suggesting, setSuggesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<ErrorDetail | null>(null);
  const [justSparkled, setJustSparkled] = useState(false);

  // Saved social-post drafts -- pulled from lead_social_drafts. Used by the
  // "Use a recent social post" dropdown so Val can inject a previously
  // generated post into the prompt with zero LLM cost.
  const [drafts, setDrafts] = useState<SocialDraft[]>([]);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState<number | ''>('');

  // Whether this lead has an active brand kit logo. Drives the Branded
  // toggle on each asset card. We don't need the full kit shape here --
  // just yes/no.
  const [hasBrandLogo, setHasBrandLogo] = useState(false);

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

  const fetchDrafts = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/social-drafts?limit=30`);
      if (!res.ok) {
        setDrafts([]);
        return;
      }
      const j = (await res.json()) as { drafts: SocialDraft[] };
      setDrafts(j.drafts ?? []);
    } catch {
      setDrafts([]);
    } finally {
      setDraftsLoaded(true);
    }
  }, [auditId]);

  useEffect(() => {
    void fetchDrafts();
  }, [fetchDrafts]);

  function injectDraft(draftId: number) {
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) return;
    setCustomPrompt(draft.body);
    setPromptSource('manual');
    // Nudge the aspect ratio toward the platform's natural fit.
    const suggested = aspectForPlatform(draft.platform);
    setAspectRatio(suggested);
    setSelectedDraftId(draftId);
  }

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

  async function handleSuggestPrompt() {
    setSuggesting(true);
    setGenerateError(null);
    try {
      const qs = new URLSearchParams({ assetType });
      if (assetType === 'video') qs.set('durationSeconds', String(durationSeconds));
      if (logoSpace !== 'none') qs.set('logoSpace', logoSpace);
      const res = await fetch(`/api/admin/av/leads/${auditId}/commercial/prompt-preview?${qs.toString()}`);
      const j = (await res.json()) as {
        ok?: boolean;
        prompt?: string;
        source?: 'visual_brief' | 'audit' | 'fallback';
        error?: string;
      };
      if (!res.ok || !j.prompt) {
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setCustomPrompt(j.prompt);
      setPromptSource(j.source ?? 'fallback');
    } catch (err) {
      setGenerateError(explainError((err as Error).message));
    } finally {
      setSuggesting(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const body: Record<string, unknown> = {
        assetType,
        resolution,
        aspectRatio,
        logoSpace
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
        const parts: string[] = [];
        if (json.error) parts.push(String(json.error));
        if (json.detail) parts.push(String(json.detail));
        if (json.code) parts.push(`code=${String(json.code)}`);
        throw new Error(parts.join(' -- ') || `HTTP ${res.status}`);
      }
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
      {/* Brand Kit -- upload a logo once, every commercial auto-composites it */}
      <BrandKitPanel
        auditId={auditId}
        onKitChange={(kit) => setHasBrandLogo(Boolean(kit?.hasLogo))}
      />

      {/* Generator card */}
      <div className="relative bg-surface border border-border rounded-2xl p-6 overflow-hidden">
        <div className="pointer-events-none absolute -top-24 -right-24 w-64 h-64 rounded-full opacity-20 blur-3xl"
             style={{ background: 'linear-gradient(135deg, #FF5A6E 0%, #FFC73D 100%)' }} />
        <div className="pointer-events-none absolute -bottom-20 -left-24 w-56 h-56 rounded-full opacity-15 blur-3xl"
             style={{ background: 'linear-gradient(135deg, #8338EC 0%, #FF9C5B 100%)' }} />

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
              <span className="inline-block ml-2 animate-bounce" aria-hidden>✨</span>
            )}
          </h3>
        </div>
        <p className="relative text-sm text-muted mb-5">
          On-brand for this lead. Preview the prompt below, tweak it if you want, then generate.
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
                Look
              </label>
              <select
                value={imageModel}
                onChange={(e) => setImageModel(e.target.value as ImageModel)}
                className={SELECT_CLASS}
              >
                {IMAGE_MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} -- {opt.sub}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-1.5">
                Duration (seconds, 1-15)
              </label>
              <input
                type="number"
                min={1}
                max={15}
                value={durationSeconds}
                onChange={(e) =>
                  setDurationSeconds(Math.min(15, Math.max(1, Number(e.target.value) || 6)))
                }
                className={INPUT_CLASS}
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
              className={SELECT_CLASS}
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
              Resolution
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

          <div className="md:col-span-2">
            <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-1.5">
              Reserve space for a logo overlay (added in post)
            </label>
            <select
              value={logoSpace}
              onChange={(e) => setLogoSpace(e.target.value as LogoSpace)}
              className={SELECT_CLASS}
            >
              {LOGO_SPACE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted mt-1">
              Tip: AI engines render logos badly. Leave clean negative space here and drop the real logo on top in Canva, Figma, or your editor of choice.
            </p>
          </div>
        </div>

        {/* Use a recent social post as the prompt -- zero LLM cost */}
        {draftsLoaded && drafts.length > 0 && (
          <div className="relative mt-4 rounded-xl border border-border bg-bg/40 p-3">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <label className="block text-[11px] uppercase tracking-[0.12em] text-muted">
                ⚡ Use a recent social post as your prompt
              </label>
              <span className="text-[10px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-full border border-border text-muted">
                {drafts.length} saved · no extra API call
              </span>
            </div>
            <select
              value={selectedDraftId === '' ? '' : String(selectedDraftId)}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) {
                  setSelectedDraftId('');
                  return;
                }
                injectDraft(Number(v));
              }}
              className={SELECT_CLASS}
            >
              <option value="">Pick a generated post...</option>
              {drafts.map((d) => {
                const when = new Date(d.createdAt).toLocaleString();
                const preview = d.body.replace(/\s+/g, ' ').slice(0, 80);
                const tag = d.status === 'used_for_commercial' ? ' ✓ used' : '';
                return (
                  <option key={d.id} value={d.id}>
                    {PLATFORM_LABEL[d.platform]} · {when}{tag} -- {preview}{d.body.length > 80 ? '...' : ''}
                  </option>
                );
              })}
            </select>
            <p className="text-[11px] text-muted mt-1">
              Picking a post drops it straight into the prompt below and snaps the aspect ratio to that channel&apos;s best fit. Edit anything before you generate.
            </p>
          </div>
        )}

        {/* Prompt area -- now visible + editable by default */}
        <div className="relative mt-4">
          <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
            <label className="block text-[11px] uppercase tracking-[0.12em] text-muted">
              Prompt sent to the AI engine
            </label>
            <div className="flex items-center gap-2">
              {promptSource && (
                <span className="text-[10px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-full border border-border text-muted">
                  Source: {promptSource.replace('_', ' ')}
                </span>
              )}
              <button
                type="button"
                onClick={() => void handleSuggestPrompt()}
                disabled={suggesting}
                className="text-[11px] px-3 py-1 rounded-full text-white font-medium disabled:opacity-60"
                style={{
                  background: 'linear-gradient(120deg, #4A1942, #8338EC)',
                  boxShadow: '0 4px 12px -4px rgba(131,56,236,0.4)'
                }}
              >
                {suggesting ? 'Drafting...' : '✨ Suggest prompt'}
              </button>
              {customPrompt && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomPrompt('');
                    setPromptSource(null);
                  }}
                  className="text-[11px] px-2 py-1 rounded text-muted hover:text-ink"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <textarea
            value={customPrompt}
            onChange={(e) => {
              setCustomPrompt(e.target.value);
              setPromptSource('manual');
            }}
            placeholder="Click Suggest prompt to auto-build one from this lead's visual brief, or type your own. The text here is what the AI engine sees verbatim."
            rows={6}
            className={TEXTAREA_CLASS}
            maxLength={4000}
          />
          <div className="text-[11px] text-muted mt-1 flex items-center justify-between">
            <span>{customPrompt.length} / 4000</span>
            {customPrompt.length === 0 && (
              <span className="text-amber-300">
                Empty prompt -- a default will be auto-built at generation time.
              </span>
            )}
          </div>
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
                auditId={auditId}
                asset={asset}
                hasBrandLogo={hasBrandLogo}
                onDelete={() => handleDelete(asset.assetId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetCard({
  auditId,
  asset,
  hasBrandLogo,
  onDelete
}: {
  auditId: string;
  asset: Asset;
  hasBrandLogo: boolean;
  onDelete: () => void;
}) {
  const isRunning =
    asset.generationStatus === 'running' || asset.generationStatus === 'queued';

  // Branded vs raw view. Defaults ON when this lead has a logo + this is an image.
  // Video composite is Phase 2; never offer Branded toggle for videos in Phase 1.
  const brandedAvailable = hasBrandLogo && asset.assetType === 'image' && Boolean(asset.url);
  const [showBranded, setShowBranded] = useState<boolean>(brandedAvailable);
  // If the lead's brand kit loads AFTER this card has mounted (common --
  // BrandKitPanel fetches in a separate useEffect), flip every existing
  // card to the branded view automatically. Only auto-flip TO branded;
  // if the user manually clicked off, we respect that until they click
  // again.
  const [userTouched, setUserTouched] = useState(false);
  useEffect(() => {
    if (!userTouched && brandedAvailable && !showBranded) {
      setShowBranded(true);
    }
  }, [brandedAvailable, userTouched, showBranded]);

  // The URL that download / preview should point to right now.
  const displayUrl = showBranded && brandedAvailable
    ? `/api/admin/av/leads/${auditId}/commercial/${asset.assetId}/branded`
    : asset.url;

  return (
    <div className="group bg-surface border border-border rounded-2xl overflow-hidden flex flex-col transition-all hover:border-pink-400/40 hover:shadow-xl hover:shadow-pink-500/5 hover:-translate-y-0.5">
      <div className="aspect-video bg-black flex items-center justify-center relative">
        {displayUrl ? (
          asset.assetType === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayUrl}
              alt={shortPrompt(asset.prompt, 80)}
              className="w-full h-full object-cover"
            />
          ) : (
            <video
              src={displayUrl}
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
                ? 'Rendering -- 30s to a few minutes.'
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

        {/* Branded toggle pill -- only shown when a brand kit exists and this is an image */}
        {brandedAvailable && (
          <button
            type="button"
            onClick={() => {
              setUserTouched(true);
              setShowBranded((b) => !b);
            }}
            className="absolute bottom-2 left-2 px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-[0.12em] font-semibold backdrop-blur transition-all"
            style={{
              background: showBranded
                ? 'linear-gradient(120deg, #56B870, #FFC73D)'
                : 'rgba(0,0,0,0.6)',
              color: showBranded ? '#0F1F33' : '#FFE2DE',
              boxShadow: showBranded ? '0 4px 12px -4px rgba(86,184,112,0.4)' : 'none'
            }}
            title={showBranded ? 'Branded view -- click to see raw' : 'Click for branded view'}
          >
            {showBranded ? '🎨 branded' : 'raw'}
          </button>
        )}
      </div>

      <div className="p-3 flex-1 flex flex-col gap-2">
        <p className="text-xs text-ink leading-relaxed">{shortPrompt(asset.prompt)}</p>
        <div className="text-[10px] text-muted flex flex-wrap gap-x-3 gap-y-1">
          <span>{friendlyModelLabel(asset.model)}</span>
          <span>{asset.resolutionTier.toUpperCase()}</span>
          {asset.aspectRatio && <span>{asset.aspectRatio}</span>}
          <span>{new Date(asset.createdAt).toLocaleString()}</span>
        </div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {asset.url ? (
            <a
              href={`/admin/social?asset_id=${asset.assetId}&intent=publish`}
              className="px-3 py-1.5 rounded-full text-xs font-medium text-white inline-flex items-center gap-1.5 transition-all"
              style={{
                background: 'linear-gradient(120deg, #FF5A6E, #FF9C5B)',
                boxShadow: '0 4px 12px -4px rgba(255,90,110,0.4)'
              }}
              title="Push this commercial to LinkedIn, X, Instagram, Facebook, or TikTok"
            >
              <span aria-hidden>📣</span> Push to social
            </a>
          ) : null}
          {displayUrl ? (
            <a
              href={displayUrl}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="px-3 py-1.5 rounded-full border border-border text-xs hover:border-pink-400 text-ink transition-colors"
              title={showBranded && brandedAvailable ? 'Download branded composite' : 'Download raw asset'}
            >
              Download{showBranded && brandedAvailable ? ' (branded)' : ''}
            </a>
          ) : null}
          {asset.url ? (
            <button
              type="button"
              onClick={() => {
                // Copy the RAW provider URL -- the branded route is an
                // authenticated app endpoint, useless outside the admin.
                void navigator.clipboard?.writeText(asset.url!);
              }}
              className="px-3 py-1.5 rounded-full border border-border text-xs text-muted hover:text-ink hover:border-pink-400 transition-colors"
              title="Copy the raw upstream URL"
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
