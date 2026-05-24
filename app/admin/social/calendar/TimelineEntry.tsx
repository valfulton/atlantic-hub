'use client';

/**
 * One timeline chip + its review drawer.
 *
 * Published items with a provider link stay simple external links. Everything
 * still in-flight (draft / scheduled / failed / publishing) becomes a button
 * that opens a review drawer: read the copy, see the attached commercial, see
 * the failure reason, and PUBLISH only after looking -- the approval gate the
 * read-only calendar was missing. (Branding the attached commercial before
 * publish is the next sub-step; image branding lives in lib/brand_kit.)
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TimelineItem, TimelineItemStatus } from '@/lib/pr/types';

const STATUS_STYLE: Record<TimelineItemStatus, { label: string; bg: string; fg: string }> = {
  draft: { label: 'Draft', bg: 'rgba(148,163,184,0.18)', fg: '#cbd5e1' },
  scheduled: { label: 'Scheduled', bg: 'rgba(59,130,246,0.20)', fg: '#93c5fd' },
  publishing: { label: 'Publishing', bg: 'rgba(245,158,11,0.20)', fg: '#fcd34d' },
  published: { label: 'Published', bg: 'rgba(16,185,129,0.22)', fg: '#6ee7b7' },
  failed: { label: 'Failed', bg: 'rgba(239,68,68,0.20)', fg: '#fca5a5' },
  canceled: { label: 'Canceled', bg: 'rgba(148,163,184,0.12)', fg: '#94a3b8' }
};

const REVIEWABLE: TimelineItemStatus[] = ['draft', 'scheduled', 'failed', 'publishing'];

/** Brand accent by tenant — at-a-glance "which brand is this post for". */
const BRAND_ACCENT: Record<string, string> = {
  av: '#FFC73D',   // Atlantic & Vine — gold
  ebw: '#2DD4BF',  // Events by Water — teal
  hh: '#F4A340'    // Hunter Honey — honey-amber
};

export function TimelineEntry({ item }: { item: TimelineItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const s = STATUS_STYLE[item.status];
  const brand = BRAND_ACCENT[item.tenant] ?? '#94a3b8';
  const chip = (
    <div
      className="rounded px-1.5 py-1 text-[11px] leading-tight truncate"
      style={{ background: s.bg, color: s.fg, borderLeft: `3px solid ${brand}` }}
      title={`${item.providerLabel ? item.providerLabel + ' · ' : ''}${item.title} - ${s.label}`}
    >
      {item.providerLabel && (
        <span
          className="inline-block align-middle mr-1 px-1 rounded-sm text-[9px] font-bold uppercase tracking-wide"
          style={{ background: 'rgba(255,255,255,0.10)', color: brand }}
        >
          {item.providerLabel}
        </span>
      )}
      <span className="font-medium">{s.label}</span> <span style={{ opacity: 0.85 }}>{item.title}</span>
    </div>
  );

  // Published with a real link -> just go to the live post.
  if (item.status === 'published' && item.link) {
    return (
      <a href={item.link} target="_blank" rel="noreferrer" className="block focus-visible:ring-2 focus-visible:ring-brand rounded">
        {chip}
      </a>
    );
  }

  const canReview = REVIEWABLE.includes(item.status) && item.outboxId != null;
  if (!canReview) return <div>{chip}</div>;

  async function publishNow() {
    if (item.outboxId == null) return;
    setPublishing(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/social/publish/${item.outboxId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setErr(json.error || `Publish failed (${res.status})`);
        return;
      }
      setMsg(json.providerUrl ? `Posted: ${json.providerUrl}` : 'Posted to the connected account.');
      setTimeout(() => {
        setOpen(false);
        router.refresh();
      }, 900);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  async function deletePost() {
    if (item.outboxId == null) return;
    setDeleting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/social/publish/${item.outboxId}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setErr(json.error || `Delete failed (${res.status})`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  const isImage = !!item.mediaUrl && item.mediaType === 'image';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full text-left focus-visible:ring-2 focus-visible:ring-brand rounded"
        aria-label={`Review ${item.title}`}
      >
        {chip}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-lg rounded-2xl p-5"
            style={{ background: '#0e1420', border: '1px solid rgba(255,255,255,0.12)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                  style={{ background: s.bg, color: s.fg }}
                >
                  {s.label}
                </span>
                <span className="text-sm font-medium" style={{ color: '#fff' }}>
                  {item.providerLabel ?? 'Social'} post
                </span>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted hover:text-ink">
                Close
              </button>
            </div>

            {item.status === 'failed' && item.errorMessage && (
              <div className="mb-3 rounded-lg px-3 py-2 text-[13px]" style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}>
                <span className="block text-[10px] uppercase tracking-[0.12em] mb-1">Last failure</span>
                {item.errorMessage}
              </div>
            )}

            <div className="rounded-lg px-3 py-2 mb-3 whitespace-pre-wrap text-[14px]" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', color: '#e5e7eb', maxHeight: 280, overflowY: 'auto' }}>
              {item.bodyText?.trim() || <span className="text-muted">No copy on this post.</span>}
            </div>

            {item.mediaUrl && (
              <div className="mb-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-muted mb-1">Attached commercial</div>
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.mediaUrl} alt="commercial preview" className="rounded-lg max-h-48 border border-border" />
                ) : (
                  <a href={item.mediaUrl} target="_blank" rel="noreferrer" className="text-sm text-brand hover:underline break-all">
                    {item.mediaUrl}
                  </a>
                )}
                <p className="text-[11px] text-muted mt-1">Logo branding for video is coming; image branding lives in the brand kit.</p>
              </div>
            )}

            {msg && <div className="mb-3 rounded-lg px-3 py-2 text-[13px]" style={{ background: 'rgba(16,185,129,0.12)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.3)' }}>{msg}</div>}
            {err && <div className="mb-3 rounded-lg px-3 py-2 text-[13px]" style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' }}>{err}</div>}

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void deletePost()}
                disabled={deleting || publishing}
                className="rounded-lg px-3 py-2 text-sm disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
                style={{ background: 'rgba(148,163,184,0.12)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.3)' }}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button
                type="button"
                onClick={() => void publishNow()}
                disabled={publishing || deleting}
                className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand"
                style={{ background: 'rgba(16,185,129,0.22)', color: '#34d399', border: '1px solid rgba(16,185,129,0.4)' }}
              >
                {publishing ? 'Publishing…' : item.status === 'failed' ? 'Retry publish' : 'Approve & publish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
