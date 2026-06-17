'use client';

/**
 * EditCaseNoteButton  (val 2026-06-16, #710)
 *
 * Pencil icon on each case_note that, when clicked, swaps the body into
 * an inline textarea + Save/Cancel buttons. PATCHes the note via the
 * note-id route. Owner/staff can edit any note; client_user can edit
 * their own.
 *
 * Renders client-side. Parent passes initial body + note metadata; on
 * successful save we call router.refresh() so the server re-fetches and
 * re-renders the note list.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  caseId: number;
  noteId: number;
  initialBody: string;
  /** When true, render a pin-toggle row alongside (operator only). */
  showPinToggle?: boolean;
  initialPinned?: boolean;
  /** Hide the button entirely when the viewer can't edit this note. */
  canEdit?: boolean;
}

export default function EditCaseNoteButton({
  caseId,
  noteId,
  initialBody,
  showPinToggle = false,
  initialPinned = false,
  canEdit = true
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(initialBody);
  const [pinned, setPinned] = useState(initialPinned);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canEdit) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setBody(initialBody); setPinned(initialPinned); setErr(null); }}
        title="Edit this note"
        style={{
          // (val 2026-06-16, color fix) Gold accent — matches the
          // MarkdownEditButton on the operator viewer. Emerald-deep dies on
          // the operator dark panel; gold is the canonical "jewelry on dark"
          // pattern across the operator surface (per the brand memory).
          background: 'transparent',
          border: '1px solid rgba(230,206,126,0.35)',
          color: '#E6CE7E',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.04em',
          cursor: 'pointer',
          padding: '4px 12px',
          borderRadius: 6
        }}
        aria-label="Edit note"
      >
        ✎ Edit
      </button>
    );
  }

  function save() {
    const trimmed = body.trim();
    if (!trimmed) { setErr('note body required'); return; }
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/av/cases/${caseId}/notes/${noteId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: trimmed, pinned: showPinToggle ? pinned : undefined })
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.ok) throw new Error(j.error || 'save failed');
        setOpen(false);
        router.refresh();
      } catch (e) {
        setErr((e as Error).message || 'network error');
      }
    });
  }

  return (
    <div
      style={{
        marginTop: 10,
        padding: 12,
        background: '#FFFFFF',
        border: '1px solid rgba(10,77,60,0.25)',
        borderRadius: 8
      }}
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={Math.max(5, Math.min(20, body.split('\n').length + 1))}
        style={{
          width: '100%',
          padding: '8px 10px',
          border: '1px solid rgba(10,77,60,0.25)',
          borderRadius: 6,
          fontSize: 14,
          lineHeight: 1.5,
          // Explicit dark text — see AddCaseNoteForm note about --ink resolving
          // light on the operator dark theme.
          color: '#14201B',
          background: '#fff',
          fontFamily: 'inherit',
          resize: 'vertical'
        }}
      />
      {showPinToggle && (
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 11, color: '#5C6862', letterSpacing: '0.06em',
          textTransform: 'uppercase', marginTop: 8
        }}>
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          Pin to top
        </label>
      )}
      {err && (
        <div style={{ fontSize: 12, color: '#A23B2E', marginTop: 6 }}>{err}</div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => { setOpen(false); setErr(null); }}
          disabled={pending}
          style={{
            // Cancel: ghost on dark — matches MarkdownEditButton viewer Cancel.
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.18)',
            color: '#94a3b8',
            padding: '6px 14px',
            borderRadius: 6,
            fontSize: 13,
            cursor: pending ? 'wait' : 'pointer'
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          style={{
            // Save: solid gold on dark — same as MarkdownEditButton viewer Save.
            // Disabled state dims to slate so the button doesn't shout when
            // there's nothing to save.
            background: pending ? '#94a3b8' : '#E6CE7E',
            border: 'none',
            color: '#0a0f1a',
            padding: '6px 16px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.04em',
            cursor: pending ? 'wait' : 'pointer'
          }}
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
