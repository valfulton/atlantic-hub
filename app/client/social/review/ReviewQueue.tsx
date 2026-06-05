'use client';

/**
 * ReviewQueue  (#61 Inc 3 + 4-polish-A/B)
 *
 * Client-side review for line-born social drafts.
 *   - Branded video preview (or image)
 *   - Editable caption — what they edit becomes what gets published
 *   - "Note to Val" — free-text note that saves on approve OR reject
 *   - Download branded mp4 (right-click / save the link)
 *   - Approve & schedule (uses the edited copy) / Reject
 *
 * Per feedback_client_simplicity: small, focused, no machinery exposed.
 * Operator can do anything; client gets the bare minimum that matters.
 */
import { useCallback, useState } from 'react';

interface ReviewItem {
  outboxId: number;
  provider: string;
  providerDisplayName: string | null;
  bodyText: string | null;
  clientEditedBody: string | null;
  clientNotes: string | null;
  mediaUrl: string | null;
  mediaType: 'none' | 'image' | 'video' | 'carousel';
  assetId: number | null;
  previewUrl: string | null;
  downloadUrl: string | null;
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

/** A single review card — encapsulates the per-item local state (caption
 *  edits, note draft, busy flag) so cards don't share refs through a parent
 *  map. Keeps the parent tiny + makes optimistic removal simple. */
function ReviewCard({
  item,
  onRemove
}: {
  item: ReviewItem;
  onRemove: (id: number) => void;
}) {
  // Default editable caption: whatever the client most recently saved (if
  // anything), else the operator's draft. Notes default to last-saved.
  const [caption, setCaption] = useState<string>(item.clientEditedBody ?? item.bodyText ?? '');
  const [note, setNote] = useState<string>(item.clientNotes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const captionDirty = (caption ?? '').trim() !== (item.bodyText ?? '').trim();

  const decide = useCallback(async (decision: 'approve' | 'reject') => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/client/social/outbox/${item.outboxId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          editedBody: captionDirty ? caption : null,
          notes: note && note.trim() ? note : null
        })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? `HTTP ${res.status}`);
        return;
      }
      onRemove(item.outboxId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [caption, captionDirty, note, item.outboxId, onRemove]);

  const previewing = item.previewUrl && (item.mediaType === 'video' || item.mediaType === 'image');

  return (
    <li className="rounded-2xl border border-border bg-black/20 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row gap-4">
        {previewing && (
          <div className="sm:w-56 shrink-0 flex flex-col gap-2">
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
            {item.downloadUrl && (
              <a
                href={item.downloadUrl}
                download
                className="text-[11px] text-center text-muted hover:text-ink underline-offset-2 hover:underline transition"
                title="Save a copy of the branded video to your computer."
              >
                ⬇ Download branded video
              </a>
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

          {/* Editable caption. The operator's draft sits as the placeholder
              when the client clears it (so they can recover). Soft hint when
              edited so they know their copy will be used. */}
          <div className="mt-3">
            <label className="block text-[10px] uppercase tracking-[0.14em] text-muted mb-1">
              Caption
            </label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={Math.max(3, Math.min(8, caption.split('\n').length + 1))}
              className="w-full text-sm rounded-lg border border-border bg-black/30 px-3 py-2 text-ink leading-relaxed focus:outline-none focus:border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)] transition"
              placeholder={item.bodyText ?? 'Write the caption…'}
              disabled={busy}
            />
            {captionDirty && (
              <p className="text-[11px] mt-1" style={{ color: '#fde68a' }}>
                Your edit will replace the original when you approve.
              </p>
            )}
          </div>

          {/* Note to Val — sends with whichever decision the client makes. */}
          <div className="mt-3">
            <label className="block text-[10px] uppercase tracking-[0.14em] text-muted mb-1">
              Note to Val (optional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full text-sm rounded-lg border border-border bg-black/30 px-3 py-2 text-ink leading-relaxed focus:outline-none focus:border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)] transition"
              placeholder="Any thoughts? E.g. 'punch up the open line' or 'love it, schedule after 6/1'"
              disabled={busy}
            />
          </div>

          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => decide('approve')}
              disabled={busy}
              className={
                'text-sm px-3 py-1.5 rounded-md border transition ' +
                (busy
                  ? 'border-white/10 text-white/30 cursor-not-allowed'
                  : 'border-emerald-400/40 text-emerald-200 hover:border-emerald-400/70 bg-emerald-400/10')
              }
            >
              {busy ? 'Saving…' : captionDirty ? '✓ Approve with my edits' : '✓ Approve & schedule'}
            </button>
            <button
              type="button"
              onClick={() => decide('reject')}
              disabled={busy}
              className={
                'text-sm px-3 py-1.5 rounded-md border transition ' +
                (busy
                  ? 'border-white/10 text-white/30 cursor-not-allowed'
                  : 'border-border text-muted hover:text-cream hover:border-[#C7A64E]/50')
              }
              title={
                note && note.trim()
                  ? 'Reject this draft and send your note back to Val.'
                  : 'Reject this draft (add a note above to tell Val why).'
              }
            >
              {note && note.trim() ? 'Reject + send note' : 'Reject'}
            </button>
            {err && (
              <span className="text-[11px]" style={{ color: '#fca5a5' }}>{err}</span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

export function ReviewQueue({ initialItems }: { initialItems: ReviewItem[] }) {
  const [items, setItems] = useState<ReviewItem[]>(initialItems);
  const removeItem = useCallback((id: number) => {
    setItems((rows) => rows.filter((r) => r.outboxId !== id));
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
      {items.map((item) => (
        <ReviewCard key={item.outboxId} item={item} onRemove={removeItem} />
      ))}
    </ul>
  );
}
