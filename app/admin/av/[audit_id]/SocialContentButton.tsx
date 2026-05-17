'use client';
import { useState } from 'react';

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

export function SocialContentButton({ auditId }: { auditId: string }) {
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
                  <PostList platform="LinkedIn" posts={result.linkedin ?? []} />
                  <PostList platform="Twitter / X" posts={result.twitter ?? []} />
                  <PostList platform="Instagram" posts={result.instagram ?? []} />
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

function PostList({ platform, posts }: { platform: string; posts: string[] }) {
  if (posts.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs uppercase tracking-wider text-muted mb-2">{platform}</h4>
      <div className="space-y-2">
        {posts.map((p, i) => (
          <PostCard key={i} content={p} index={i + 1} />
        ))}
      </div>
    </div>
  );
}

function PostCard({ content, index }: { content: string; index: number }) {
  const [copied, setCopied] = useState(false);
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
        <button
          type="button"
          onClick={handleCopy}
          className="text-xs px-2 py-1 rounded border border-border text-muted hover:text-ink hover:border-brand transition-colors shrink-0"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div className="text-[10px] text-muted/60 mt-1.5">#{index} · {content.length} chars</div>
    </div>
  );
}
