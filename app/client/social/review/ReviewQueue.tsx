'use client';

/**
 * ReviewQueue  (#61 Inc 3)
 *
 * Client-side renderer for the line-born social draft queue. Each card shows
 * the branded video preview (or image), the platform target, the caption,
 * and which narrative line it advances. Approve/Reject buttons hit the
 * decide endpoint and remove the card from the queue on success.
 *
 * Per feedback_client_simplicity: zero machinery beyond the call to action.
 * No tenant ids, no asset ids, no internal status names — just facts and
 * two clear choices.
 */
import { useCallback, useState } from 'react';

interface ReviewItem {
  outboxId: number;
  provider: string;
  providerDisplayName: string | null;
  bodyText: string | null;
  mediaUrl: string | null;
  mediaType: 'none' | 'image' | 'video' | 'carousel';
  assetId: number | null;
  previewUrl: string | null;
  narrativeLineId: number | null;
  narrativeLineName: string | null;
  createdAt: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  threads: 'Threads',
  tiktok: 'TikTok',
  youtube: 'YouTube'
};

function providerLabel(p: string): string {
  return PROVIDER_LABEL[p] ?? p;
}

export function ReviewQueue({ initialItems }: { initialItems: ReviewItem[] }) {
  const [items, setItems] = useState<ReviewItem[]>(initialItems);
  const [deciding, setDeciding] = useState<Record<number, { loading: boolean; msg: string | null }>>({});

  const decide = useCallback(async (outboxId: number, decision: 'approve' | 'reject') => {
    setDeciding((s) => ({ ...s, [outboxId]: { loading: true, msg: null } }));
    try {
      const res = await fetch(`/api/client/social/outbox/${outboxId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeciding((s) => ({ ...s, [outboxId]: { loading: false, msg: j.error ?? `HTTP ${res.status}` } }));
        return;
      }
      // Drop the row from the queue on success — there's nothing else to do
      // with it from this surface.
      setItems((rows) => rows.filter((r) => r.outboxId !== outboxId));
    } catch (e) {
      setDeciding((s) => ({ ...s, [outboxId]: { loading: false, msg: (e as Error).message } }));
    }
  }, []);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-black/20 p-8 text-center">
        <p className="text-sm text-muted">Nothing waiting for review right now.</p>
        <p className="text-[12px] text-muted mt-1">
          When commercials are queued for your approval, they&apos;ll appear here.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-4">
      {items.map((item) => {
        const state = deciding[item.outboxId];
        const previewing = item.previewUrl && (item.mediaType === 'video' || item.mediaType === 'image');
        return (
          <li
            key={item.outboxId}
            className="rounded-2xl border border-border bg-black/20 p-4 sm:p-5"
          >
            <div className="flex flex-col sm:flex-row gap-4">
              {/* Media preview — branded video when available, else raw. */}
              {previewing && (
                <div className="sm:w-56 shrink-0">
                  {item.mediaType === 'video' ? (
                    <video
                      src={item.previewUrl ?? undefined}
                      controls
                      preload="metadata"
                      className="w-full rounded-lg bg-black"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.previewUrl ?? ''}
                      alt="Commercial preview"
                      className="w-full rounded-lg bg-black"
                    />
                  )}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-brand">
                    {providerLabel(item.provider)}
                  </span>
                  {item.providerDisplayName && (
                    <span className="text-[11px] text-muted">· {item.providerDisplayName}</span>
                  )}
                  {item.narrativeLineName && (
                    <span className="text-[11px] text-muted">
                      · advances <span className="text-ink/80">{item.narrativeLineName}</span>
                    </span>
                  )}
                </div>
                {item.bodyText && (
                  <p className="text-sm text-ink mt-2 leading-relaxed whitespace-pre-wrap">
                    {item.bodyText}
                  </p>
                )}
                <div className="mt-4 flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => decide(item.outboxId, 'approve')}
                    disabled={state?.loading}
                    className={
                      'text-sm px-3 py-1.5 rounded-md border transition ' +
                      (state?.loading
                        ? 'border-white/10 text-white/30 cursor-not-allowed'
                        : 'border-emerald-400/40 text-emerald-200 hover:border-emerald-400/70 bg-emerald-400/10')
                    }
                  >
                    {state?.loading ? 'Saving…' : '✓ Approve & schedule'}
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(item.outboxId, 'reject')}
                    disabled={state?.loading}
                    className={
                      'text-sm px-3 py-1.5 rounded-md border transition ' +
                      (state?.loading
                        ? 'border-white/10 text-white/30 cursor-not-allowed'
                        : 'border-rose-400/40 text-rose-200 hover:border-rose-400/70 bg-rose-400/10')
                    }
                  >
                    Reject
                  </button>
                  {state?.msg && (
                    <span className="text-[11px]" style={{ color: '#fca5a5' }}>{state.msg}</span>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
