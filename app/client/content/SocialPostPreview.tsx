/**
 * SocialPostPreview — renders one queued draft (ClientReviewItem) as it will
 * look on its platform (LinkedIn / Instagram / X / Facebook), with Approve ·
 * Edit · Reject. The post card mimics the native platform (white, platform
 * colors) regardless of the app skin; only the surrounding chrome follows the
 * skin. Caption is editable inline; the edit rides through on Approve.
 */
'use client';
import { useState } from 'react';
import type { ClientReviewItem } from '@/lib/client/social_review';

type PK = 'linkedin' | 'instagram' | 'x' | 'facebook';
const META: Record<PK, { label: string; badge: string; bg: string }> = {
  linkedin:  { label: 'LinkedIn',  badge: 'in', bg: '#0a66c2' },
  instagram: { label: 'Instagram', badge: '◎',  bg: 'linear-gradient(45deg,#f09433,#dc2743,#bc1888)' },
  x:         { label: 'X',         badge: '𝕏',  bg: '#000' },
  facebook:  { label: 'Facebook',  badge: 'f',  bg: '#1877f2' },
};
function platformKey(p: string): PK {
  const s = (p || '').toLowerCase();
  if (s.includes('insta')) return 'instagram';
  if (s.includes('face')) return 'facebook';
  if (s === 'x' || s.includes('twitter')) return 'x';
  return 'linkedin';
}
function ago(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} d ago`;
}

export default function SocialPostPreview({
  item, busy, onDecide,
}: {
  item: ClientReviewItem;
  busy: boolean;
  onDecide: (id: number, decision: 'approve' | 'reject', editedBody?: string) => void;
}) {
  const pk = platformKey(item.provider);
  const M = META[pk];
  const author = item.providerDisplayName || 'Your brand';
  const initial = author.trim().charAt(0).toUpperCase() || 'A';
  const [editing, setEditing] = useState(false);
  const [caption, setCaption] = useState(item.clientEditedBody || item.bodyText || '');
  const edited = caption !== (item.clientEditedBody || item.bodyText || '');
  const media = item.previewUrl || item.mediaUrl;
  const isVideo = item.mediaType === 'video';
  const isIG = pk === 'instagram';

  const Media = media ? (
    <div style={{ position: 'relative', aspectRatio: isIG ? '1 / 1' : '1.91 / 1', background: 'var(--studio-media, #0b0b0b)' }}>
      {isVideo ? (
        <video src={media} controls preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
    </div>
  ) : null;

  return (
    <article className="studio-post">
      {/* generated/campaign tag (chrome — follows skin via .studio-tag) */}
      <div className="studio-tag">
        <span className="dot" /> Generated {ago(item.createdAt)} · {M.label}
        {item.narrativeLineName ? <> · advancing <b>{item.narrativeLineName}</b></> : null}
      </div>

      <div style={{ background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: '0 8px 24px -14px rgba(0,0,0,.35)' }}>
        {/* platform header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.55rem', padding: '.7rem .8rem' }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg,#3DAB85,#0A4D3C)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: '.85rem', flexShrink: 0 }}>{initial}</div>
          <div style={{ lineHeight: 1.15 }}>
            <div style={{ fontSize: '.82rem', fontWeight: 700, color: '#111' }}>{author}</div>
            <small style={{ fontSize: '.66rem', color: '#777' }}>Draft preview</small>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: '.62rem', fontWeight: 700, color: '#fff', background: M.bg, padding: '.18rem .5rem', borderRadius: 5, minWidth: 22, textAlign: 'center' }}>{M.badge}</span>
        </div>

        {/* caption (above media on LinkedIn/X/FB; below on IG) */}
        {!isIG && (
          editing
            ? <textarea value={caption} onChange={(e) => setCaption(e.target.value)} style={capStyle} />
            : <p style={{ fontSize: '.82rem', color: '#1a1a1a', padding: '0 .8rem .6rem', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{caption}</p>
        )}

        {Media}

        {/* platform action bar (visual) */}
        {isIG ? (
          <>
            <div style={{ display: 'flex', gap: '.9rem', padding: '.55rem .8rem .2rem', fontSize: '1.15rem' }}>♥ &nbsp; 💬 &nbsp; ➦ <span style={{ marginLeft: 'auto' }}>🔖</span></div>
            <div style={{ padding: '.2rem .8rem .7rem', fontSize: '.78rem', color: '#222' }}>
              <b>{author.toLowerCase().replace(/\s+/g, '')}</b>{' '}
              {editing
                ? <textarea value={caption} onChange={(e) => setCaption(e.target.value)} style={{ ...capStyle, marginTop: 6 }} />
                : caption}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', padding: '.5rem .6rem', color: '#666', fontSize: '.72rem', fontWeight: 600, borderTop: '1px solid #EEE' }}>
            {pk === 'x'
              ? <><span style={{ flex: 1, textAlign: 'center' }}>💬 Reply</span><span style={{ flex: 1, textAlign: 'center' }}>🔁 Repost</span><span style={{ flex: 1, textAlign: 'center' }}>♥ Like</span><span style={{ flex: 1, textAlign: 'center' }}>📊 View</span></>
              : <><span style={{ flex: 1, textAlign: 'center' }}>👍 Like</span><span style={{ flex: 1, textAlign: 'center' }}>💬 Comment</span><span style={{ flex: 1, textAlign: 'center' }}>🔁 Repost</span><span style={{ flex: 1, textAlign: 'center' }}>➤ Send</span></>}
          </div>
        )}
      </div>

      {/* A&V approval row (chrome) */}
      <div className="studio-actions">
        <button className="studio-pri" disabled={busy} onClick={() => onDecide(item.outboxId, 'approve', edited ? caption : undefined)}>✓ Approve &amp; schedule</button>
        <button className="studio-sec" disabled={busy} onClick={() => setEditing((v) => !v)}>{editing ? 'Done editing' : '✎ Edit'}</button>
        <button className="studio-sec" disabled={busy} onClick={() => onDecide(item.outboxId, 'reject')}>Reject</button>
      </div>
    </article>
  );
}

const capStyle: React.CSSProperties = {
  width: 'calc(100% - 1.6rem)', margin: '0 .8rem .6rem', minHeight: 70, fontFamily: 'inherit',
  fontSize: '.82rem', border: '1px solid #ddd', borderRadius: 8, padding: '.5rem', color: '#111',
};
