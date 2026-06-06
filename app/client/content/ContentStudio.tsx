/**
 * ContentStudio — the client's in-app feed of generated content, threaded as
 * real social posts. Reuses the existing review queue (listClientReviewQueue)
 * + decide endpoint. Platform filter + per-post Approve / Edit / Reject. Chrome
 * follows the app skin via the `studio-*` classes (define once in the app design
 * system / the-wire register); the post cards are platform-authentic.
 */
'use client';
import { useMemo, useState } from 'react';
import type { ClientReviewItem } from '@/lib/client/social_review';
import SocialPostPreview from './SocialPostPreview';

const FILTERS = ['All', 'LinkedIn', 'Instagram', 'X', 'Facebook'] as const;
function matches(provider: string, f: string): boolean {
  if (f === 'All') return true;
  const s = (provider || '').toLowerCase();
  if (f === 'X') return s === 'x' || s.includes('twitter');
  return s.includes(f.toLowerCase());
}

export default function ContentStudio({
  items: initial,
  firstName,
  preview = false
}: {
  items: ClientReviewItem[];
  firstName: string;
  /** (#419) Operator preview mode — disables Approve/Edit/Reject buttons so
   *  the operator mirror doesn't hit the client-only /decide endpoint (would
   *  401 against the operator session). Same data, same render, no writes. */
  preview?: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<string>('All');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [celebrate, setCelebrate] = useState(false);

  const shown = useMemo(() => items.filter((i) => matches(i.provider, filter)), [items, filter]);
  // Per-filter counts so the chips show the platform mix at a glance, and
  // empty platforms are hidden (only "All" + platforms with posts render).
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of FILTERS) c[f] = items.filter((i) => matches(i.provider, f)).length;
    return c;
  }, [items]);

  async function onDecide(id: number, decision: 'approve' | 'reject', editedBody?: string) {
    if (preview) {
      setToast('Preview only — clients approve from /client/content.');
      setTimeout(() => setToast(''), 2200);
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/client/social/outbox/${id}/decide`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, editedBody }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.ok !== false) {
        setItems((xs) => xs.filter((x) => x.outboxId !== id));
        setToast(decision === 'approve' ? 'Approved — scheduled to post ✓' : 'Sent back');
        // Earned moment: clearing the LAST post in the queue (not every approve).
        if (decision === 'approve' && items.length === 1) {
          setCelebrate(true);
          setTimeout(() => setCelebrate(false), 2900);
        }
      } else {
        setToast(d?.reason || 'Could not save — reload and retry');
      }
    } catch {
      setToast('Network error — try again');
    } finally {
      setBusyId(null);
      setTimeout(() => setToast(''), 2200);
    }
  }

  return (
    <div className="studio">
      {celebrate && (
        <div className="av-celebrate" aria-hidden="true">
          {Array.from({ length: 16 }).map((_, i) => (
            <span
              key={i}
              className="av-confetti"
              style={{ left: `${(i * 6.2 + 4) % 96}%`, animationDelay: `${(i % 5) * 0.12}s` }}
            />
          ))}
          <div className="av-celebrate__msg">
            <b>All caught up.</b>
            <span>Every post approved and scheduled — beautifully done.</span>
          </div>
        </div>
      )}
      <section className="v3-greet">
        <p className="v3-eyebrow">Your content</p>
        <h1 className="v3-h1">Ready to <em>post.</em></h1>
        <p className="v3-lede" style={{ fontStyle: 'normal' }}>
          {items.length > 0
            ? `${items.length} ${items.length === 1 ? 'piece' : 'pieces'} ready to review${firstName ? `, ${firstName}` : ''}. This is exactly how each will look when it posts.`
            : 'Nothing waiting right now. New posts land here as your campaigns generate them — you approve before anything goes out.'}
        </p>
      </section>

      {items.length > 0 && (
        <div className="studio-filters">
          {FILTERS.filter((f) => f === 'All' || counts[f] > 0).map((f) => (
            <button key={f} className={`studio-chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>{f} ({counts[f]})</button>
          ))}
        </div>
      )}

      <div className="studio-feed">
        {shown.map((it) => (
          <SocialPostPreview key={it.outboxId} item={it} busy={busyId === it.outboxId || preview} onDecide={onDecide} />
        ))}
        {items.length > 0 && shown.length === 0 && (
          <p className="v3-lede" style={{ fontStyle: 'normal' }}>No {filter} posts in the queue.</p>
        )}
      </div>

      {toast && <div className="studio-toast" role="status">{toast}</div>}
    </div>
  );
}
