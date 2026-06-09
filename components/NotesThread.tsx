'use client';

/**
 * NotesThread — the shared chat surface for the two-way notes channel (#489).
 *
 * Used by BOTH /client/notes (client side) and
 * /admin/av/clients/[id]/notes (operator side). The page server-renders the
 * thread + marks the incoming side read; this component renders the bubbles
 * and the compose box, posts to `postUrl`, then router.refresh()es so the
 * server re-renders the thread (and re-marks read). Append-only — there is no
 * edit/delete affordance; a correction is a new note.
 *
 * Styling uses CSS variables with hex fallbacks so it reads correctly on the
 * cream client app AND the dark operator chrome.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ClientNote, NoteDirection } from '@/lib/client/notes';

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function NotesThread({
  notes,
  mySide,
  postUrl,
  composePlaceholder = 'Write a note…'
}: {
  notes: ClientNote[];
  /** The direction THIS viewer authors. Their bubbles align right. */
  mySide: NoteDirection;
  postUrl: string;
  composePlaceholder?: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  // Render timestamps only after mount — toLocaleString differs by timezone
  // between SSR and the browser, which would trip a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  async function send() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      const r = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text })
      });
      if (!r.ok) {
        setError('Could not send — try again.');
        setSending(false);
        return;
      }
      setBody('');
      setSending(false);
      router.refresh();
    } catch {
      setError('Could not send — try again.');
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter newlines.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640, margin: '0 auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {notes.length === 0 ? (
          <p style={{ textAlign: 'center', opacity: 0.6, fontSize: 14, padding: '24px 0' }}>
            No notes yet. Say hello — every note is timestamped and kept.
          </p>
        ) : (
          notes.map((n) => {
            const mine = n.direction === mySide;
            return (
              <div
                key={n.noteId}
                style={{
                  alignSelf: mine ? 'flex-end' : 'flex-start',
                  maxWidth: '82%',
                  background: mine
                    ? 'var(--emerald-deep, #0A4D3C)'
                    : 'color-mix(in srgb, var(--paper, #ffffff) 92%, transparent)',
                  color: mine ? 'var(--cream-pure, #FFFDF8)' : 'var(--ink, #14201B)',
                  border: mine ? 'none' : '1px solid color-mix(in srgb, var(--emerald-deep, #0A4D3C) 16%, transparent)',
                  borderRadius: 14,
                  borderBottomRightRadius: mine ? 4 : 14,
                  borderBottomLeftRadius: mine ? 14 : 4,
                  padding: '10px 13px',
                  boxShadow: '0 1px 2px rgba(10,77,60,0.10)'
                }}
              >
                <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{n.body}</div>
                <div
                  style={{
                    marginTop: 5,
                    fontSize: 11,
                    opacity: mine ? 0.75 : 0.55,
                    display: 'flex',
                    gap: 8,
                    justifyContent: mine ? 'flex-end' : 'flex-start'
                  }}
                >
                  <span>{n.authorEmail}</span>
                  {mounted && <><span>·</span><span>{when(n.createdAt)}</span></>}
                  {mine && n.readAt && <span>· Read</span>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Compose */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 4 }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={composePlaceholder}
          rows={2}
          style={{
            flex: 1,
            resize: 'vertical',
            minHeight: 44,
            borderRadius: 12,
            border: '1px solid color-mix(in srgb, var(--emerald-deep, #0A4D3C) 22%, transparent)',
            background: 'var(--paper, #ffffff)',
            color: 'var(--ink, #14201B)',
            padding: '11px 12px',
            fontSize: 15,
            fontFamily: 'inherit'
          }}
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !body.trim()}
          style={{
            background: 'var(--emerald-deep, #0A4D3C)',
            color: 'var(--cream-pure, #FFFDF8)',
            border: 0,
            borderRadius: 12,
            padding: '12px 18px',
            fontSize: 14,
            fontWeight: 600,
            minHeight: 44,
            cursor: sending || !body.trim() ? 'default' : 'pointer',
            opacity: sending || !body.trim() ? 0.6 : 1
          }}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {error && <p style={{ color: 'var(--garnet, #A23B2E)', fontSize: 13, margin: 0 }}>{error}</p>}
    </div>
  );
}
