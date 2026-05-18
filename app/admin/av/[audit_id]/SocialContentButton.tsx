'use client';
import { useState } from 'react';

type CommercialAssetType = 'image' | 'video';
type CommercialAspect = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';

interface CommercialResult {
  ok: boolean;
  assetId?: number;
  url?: string | null;
  generationStatus?: 'queued' | 'running' | 'succeeded' | 'failed';
  assetType?: CommercialAssetType;
  error?: string;
  detail?: string;
  code?: string;
}

/**
 * Per-lead AI social content generator. Calls
 * POST /api/admin/av/leads/[audit_id]/social-content
 * and displays the LinkedIn / Twitter / Instagram posts in a panel with
 * copy buttons per post.
 *
 * Two variants:
 *   - "For their business" — content the prospect could publish to their channels
 *   - "About their industry" — content the operator could publish to engage that vertical
 */

interface Response {
  ok: boolean;
  variant?: string;
  company?: string;
  industry?: string;
  linkedin?: string[];
  twitter?: string[];
  instagram?: string[];
  usage?: { tokens: number; model: string };
  error?: string;
  detail?: string;
  rawResponse?: string;
}

// auditId is passed all the way down so PostCard can call the commercial endpoint.
export function SocialContentButton({ auditId }: { auditId: string }) {
  return <SocialContentInner auditId={auditId} />;
}

function SocialContentInner({ auditId }: { auditId: string }) {
  const [open, setOpen] = useState(false);
  const [variant, setVariant] = useState<'for_prospect' | 'about_industry'>('for_prospect');
  const [count, setCount] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Response | null>(null);

  async function handleGenerate() {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/social-content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant, count })
      });
      const rawText = await res.text();
      let json: Response | null = null;
      try {
        json = JSON.parse(rawText) as Response;
      } catch {
        setError(`Server returned non-JSON (HTTP ${res.status}). First 200 chars: ${rawText.slice(0, 200)}`);
        return;
      }
      if (!res.ok || !json) {
        setError(json?.error || `HTTP ${res.status}`);
        return;
      }
      setResult(json);
    } catch (err) {
      setError(`Network error: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-md text-sm bg-surface border border-border hover:border-brand text-ink transition-colors inline-flex items-center gap-1.5"
        title="Generate AI social posts for this business"
      >
        <span>✨</span> Generate social content
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <div
            className="rounded-lg border border-border max-w-4xl w-full max-h-[90vh] overflow-y-auto"
            style={{ backgroundColor: '#0e1420' }}
          >
            <div className="sticky top-0 px-5 py-3 border-b border-border flex items-center justify-between" style={{ backgroundColor: '#0e1420' }}>
              <h3 className="text-base font-medium text-ink">
                ✨ AI Social Content {result?.company && <span className="text-muted font-normal">— {result.company}</span>}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted hover:text-ink p-1"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-muted mb-1">Variant</label>
                  <select
                    value={variant}
                    onChange={(e) => setVariant(e.target.value as 'for_prospect' | 'about_industry')}
                    className="px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none text-sm"
                    style={{ backgroundColor: '#1a1f2e', color: '#f1f5f9' }}
                  >
                    <option value="for_prospect">For their business (deliverable content)</option>
                    <option value="about_industry">About their industry (outbound warmup)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-muted mb-1">Posts per platform</label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={count}
                    onChange={(e) => setCount(Math.min(5, Math.max(1, Number(e.target.value) || 3)))}
                    className="w-20 px-3 py-2 rounded-md border border-border focus:border-brand focus:outline-none"
                    style={{ backgroundColor: '#1a1f2e', color: '#f1f5f9' }}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={loading}
                  className="px-4 py-2 rounded-md bg-brand text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Generating…' : 'Generate'}
                </button>
                {result?.usage && (
                  <span className="text-xs text-muted ml-2">
                    {result.usage.tokens.toLocaleString()} tokens · {result.usage.model}
                  </span>
                )}
              </div>

              {error && (
                <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200 whitespace-pre-wrap">
                  {error}
                </div>
              )}

              {result && (
                <div className="space-y-5">
                  <PostList platform="LinkedIn" posts={result.linkedin ?? []} auditId={auditId} />
                  <PostList platform="Twitter / X" posts={result.twitter ?? []} auditId={auditId} />
                  <PostList platform="Instagram" posts={result.instagram ?? []} auditId={auditId} />
                </div>
              )}

              {!result && !error && !loading && (
                <div className="text-sm text-muted">
                  <p className="mb-2">
                    Click <strong>Generate</strong> to produce ready-to-publish social posts
                    tailored to this lead&apos;s business.
                  </p>
                  <p>
                    <strong>For their business</strong> — content this prospect could publish on
                    their own channels (deliverable you can include with the audit).
                  </p>
                  <p className="mt-1">
                    <strong>About their industry</strong> — content for Atlantic &amp; Vine&apos;s
                    channels to warm up prospects in this vertical.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PostList({ platform, posts, auditId }: { platform: string; posts: string[]; auditId: string }) {
  if (posts.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs uppercase tracking-wider text-muted mb-2">{platform}</h4>
      <div className="space-y-2">
        {posts.map((p, i) => (
          <PostCard key={i} content={p} index={i + 1} auditId={auditId} platform={platform} />
        ))}
      </div>
    </div>
  );
}

function PostCard({
  content,
  index,
  auditId,
  platform
}: {
  content: string;
  index: number;
  auditId: string;
  platform: string;
}) {
  const [copied, setCopied] = useState(false);
  const [bridgeOpen, setBridgeOpen] = useState(false);

  // Suggested aspect ratio per platform -- nudges Val toward the right format.
  const suggestedAspect: CommercialAspect =
    platform.toLowerCase().includes('instagram')
      ? '1:1'
      : platform.toLowerCase().includes('linkedin')
      ? '16:9'
      : '16:9';

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // silently ignore
    }
  }

  return (
    <div className="rounded-md border border-border p-3" style={{ backgroundColor: '#1a1f2e' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-ink whitespace-pre-wrap flex-1">{content}</div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="text-xs px-2 py-1 rounded border border-border text-muted hover:text-ink hover:border-brand transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button
            type="button"
            onClick={() => setBridgeOpen((o) => !o)}
            className="text-xs px-2 py-1 rounded text-white font-medium transition-all whitespace-nowrap"
            style={{
              background: bridgeOpen
                ? 'linear-gradient(120deg, #4A1942, #8338EC)'
                : 'linear-gradient(120deg, #FF5A6E, #FF9C5B)',
              boxShadow: bridgeOpen ? 'none' : '0 4px 12px -4px rgba(255,90,110,0.5)'
            }}
            title="Generate a commercial using this post as the visual brief"
          >
            {bridgeOpen ? 'Close' : '🎬 Make commercial'}
          </button>
        </div>
      </div>
      <div className="text-[10px] text-muted/60 mt-1.5">
        #{index} · {content.length} chars
      </div>

      {bridgeOpen && (
        <PostToCommercialBridge
          auditId={auditId}
          postText={content}
          suggestedAspect={suggestedAspect}
          onClose={() => setBridgeOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Inline panel that lets the operator turn a social post into a Grok commercial
 * without leaving the social-content modal. Pre-fills the post text as the
 * custom prompt and exposes a minimal control set so the action is one click.
 */
function PostToCommercialBridge({
  auditId,
  postText,
  suggestedAspect,
  onClose
}: {
  auditId: string;
  postText: string;
  suggestedAspect: CommercialAspect;
  onClose: () => void;
}) {
  const [assetType, setAssetType] = useState<CommercialAssetType>('image');
  const [aspect, setAspect] = useState<CommercialAspect>(suggestedAspect);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<CommercialResult | null>(null);
  const [errorDetail, setErrorDetail] = useState<{ message: string; hint?: string } | null>(null);
  const [polling, setPolling] = useState(false);

  function explain(raw: string): { message: string; hint?: string } {
    const m = raw.toLowerCase();
    if (m.includes('xai_api_key') && m.includes('not configured')) {
      return {
        message: 'xAI API key is not set in Netlify.',
        hint: 'Add XAI_API_KEY in Netlify env vars, then trigger a redeploy.'
      };
    }
    if (m.includes('incorrect api key') || m.includes('invalid api key')) {
      return {
        message: 'xAI rejected the API key.',
        hint: 'Confirm the env var starts with "xai-" (not "sk-" or "OJ"). Re-paste from console.x.ai and trigger redeploy.'
      };
    }
    if (m.includes('rate limit') || m.includes('429')) {
      return { message: 'xAI rate limit hit -- wait 30s and retry.' };
    }
    return { message: raw };
  }

  async function pollAsset(assetId: number) {
    setPolling(true);
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(`/api/admin/av/leads/${auditId}/commercial/${assetId}`);
        const j = (await r.json()) as { asset?: { generationStatus?: string; url?: string | null } };
        const status = j.asset?.generationStatus;
        if (status === 'succeeded' || status === 'failed') {
          setResult((prev) =>
            prev ? { ...prev, url: j.asset?.url ?? null, generationStatus: status } : prev
          );
          break;
        }
      } catch {
        // swallow and keep polling
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    setPolling(false);
  }

  async function generate() {
    setGenerating(true);
    setErrorDetail(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        assetType,
        aspectRatio: aspect,
        resolution: '1k',
        customPrompt: postText
      };
      if (assetType === 'image') {
        body.imageModel = 'grok-imagine-image-quality';
      } else {
        body.durationSeconds = 6;
      }
      const res = await fetch(`/api/admin/av/leads/${auditId}/commercial`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const raw = await res.text();
      let json: CommercialResult = {} as CommercialResult;
      try {
        json = JSON.parse(raw) as CommercialResult;
      } catch {
        throw new Error(`Server returned non-JSON (HTTP ${res.status}). ${raw.slice(0, 200)}`);
      }
      if (!res.ok) {
        const parts = [json.error, json.detail, json.code ? `code=${json.code}` : null].filter(Boolean) as string[];
        throw new Error(parts.join(' -- ') || `HTTP ${res.status}`);
      }
      setResult(json);
      if (json.assetId && json.generationStatus === 'running') {
        void pollAsset(json.assetId);
      }
    } catch (err) {
      setErrorDetail(explain((err as Error).message));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div
      className="mt-3 rounded-lg border p-3"
      style={{
        backgroundColor: '#0e1420',
        borderColor: 'rgba(255,156,91,0.35)'
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.12em] text-amber-200 mb-2">
        ✨ Turn this post into a commercial
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex rounded-full border border-border p-0.5 bg-bg">
          <button
            type="button"
            onClick={() => setAssetType('image')}
            className={`px-3 py-1 text-xs rounded-full transition-all ${
              assetType === 'image' ? 'bg-gradient-to-r from-pink-500 to-orange-400 text-white' : 'text-muted'
            }`}
          >
            Image
          </button>
          <button
            type="button"
            onClick={() => setAssetType('video')}
            className={`px-3 py-1 text-xs rounded-full transition-all ${
              assetType === 'video' ? 'bg-gradient-to-r from-pink-500 to-orange-400 text-white' : 'text-muted'
            }`}
          >
            Video (6s)
          </button>
        </div>

        <select
          value={aspect}
          onChange={(e) => setAspect(e.target.value as CommercialAspect)}
          className="text-xs px-2 py-1 rounded border border-border"
          style={{ backgroundColor: '#1a1f2e', color: '#f1f5f9' }}
        >
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
          <option value="1:1">1:1</option>
          <option value="4:3">4:3</option>
          <option value="3:4">3:4</option>
        </select>

        <button
          type="button"
          onClick={() => void generate()}
          disabled={generating}
          className="text-xs px-3 py-1.5 rounded-full text-white font-medium disabled:opacity-60"
          style={{
            background: 'linear-gradient(120deg, #FF5A6E, #FF9C5B, #FFC73D)',
            boxShadow: '0 4px 12px -4px rgba(255,90,110,0.5)'
          }}
        >
          {generating ? 'Working...' : '✨ Generate'}
        </button>

        <button
          type="button"
          onClick={onClose}
          className="text-xs px-2 py-1 rounded text-muted hover:text-ink ml-auto"
        >
          Hide
        </button>
      </div>

      {errorDetail && (
        <div className="rounded-md border border-red-400/40 bg-red-500/10 p-2.5 text-xs text-red-100 whitespace-pre-wrap break-words">
          <div className="font-medium mb-1">Couldn&apos;t generate</div>
          <div>{errorDetail.message}</div>
          {errorDetail.hint && (
            <div className="mt-2 text-amber-100">
              <strong>Try:</strong> {errorDetail.hint}
            </div>
          )}
        </div>
      )}

      {result && result.ok && (
        <div className="rounded-md overflow-hidden border border-border bg-black">
          {result.url ? (
            result.assetType === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={result.url} alt="Generated commercial" className="w-full max-h-80 object-contain" />
            ) : (
              <video src={result.url} controls className="w-full max-h-80" />
            )
          ) : (
            <div className="p-4 text-xs text-muted text-center">
              {polling
                ? 'Video rendering on xAI -- this card will fill in when it lands (usually under 2 minutes).'
                : 'Queued.'}
            </div>
          )}
          {result.url && (
            <div className="flex items-center gap-2 px-2 py-2 bg-bg">
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="text-[11px] px-2 py-1 rounded border border-border hover:border-pink-400 text-ink"
              >
                Download
              </a>
              <a
                href={`/admin/av/${auditId}`}
                className="text-[11px] px-2 py-1 rounded border border-border hover:border-pink-400 text-muted hover:text-ink ml-auto"
              >
                View in Commercials tab
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
