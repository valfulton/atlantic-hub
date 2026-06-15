/**
 * components/case/MarkdownEditButton.tsx  (val 2026-06-15, #676 Tier B)
 *
 * Operator-side edit toggle for case documents that are markdown. Renders as
 * a pencil-style button at the top of the viewer page; on click it swaps the
 * server-rendered preview for a full-width textarea, and on save it PUTs the
 * new source to /api/admin/av/cases/[caseId]/documents/[documentId]/content.
 *
 * UX shape:
 *   - Edit button lives ABOVE the rendered markdown (sticky inside the
 *     viewer header strip, not inside the rendered <article>)
 *   - When clicked, the rendered preview hides and a textarea takes its
 *     place with the loaded source
 *   - Save button writes back via the API, then router.refresh()s so the
 *     server-rendered preview re-fetches the new bytes and renders the
 *     updated markdown
 *   - Cancel button discards the textarea edits and re-shows the original
 *     preview
 *
 * v1 is intentionally minimal: no syntax highlight, no live preview pane,
 * no autosave. Just edit text, save text. If we hit a fidelity issue we
 * upgrade to a real editor (CodeMirror or Lexical) but not before val has
 * actually used this on a real Option draft.
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

interface Props {
  caseId: number;
  documentId: number;
  /** Initial markdown source — fetched server-side and passed in to seed
   *  the textarea so we don't need a separate client fetch on Edit click. */
  initialSource: string;
  /** The rendered children (the markdown preview block). Shown when not
   *  editing; hidden while the textarea is active. */
  children: ReactNode;
}

export default function MarkdownEditButton({
  caseId,
  documentId,
  initialSource,
  children
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [source, setSource] = useState(initialSource);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/av/cases/${caseId}/documents/${documentId}/content`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: source })
        }
      );
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'save failed');
        return;
      }
      setEditing(false);
      // router.refresh() re-runs the server component for the viewer page,
      // which re-reads the bytes from hot storage and re-renders the
      // markdown. The preview now shows the saved version.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setSource(initialSource);
    setEditing(false);
    setError(null);
  }

  return (
    <>
      {/* Toolbar — always rendered, but the buttons differ by mode */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          maxWidth: 760,
          margin: '0 auto 10px',
          padding: '0 8px'
        }}
      >
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{
              fontSize: 12,
              color: '#E6CE7E',
              background: 'transparent',
              border: '1px solid rgba(230,206,126,0.35)',
              padding: '4px 12px',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 600,
              letterSpacing: '0.04em'
            }}
            title="Edit this draft inline"
          >
            ✎ Edit
          </button>
        )}
        {editing && (
          <>
            {error && (
              <span style={{ fontSize: 12, color: '#D6594E', alignSelf: 'center' }}>
                {error}
              </span>
            )}
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              style={{
                fontSize: 12,
                color: '#94a3b8',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.18)',
                padding: '4px 12px',
                borderRadius: 6,
                cursor: saving ? 'wait' : 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || source === initialSource}
              style={{
                fontSize: 12,
                color: '#0a0f1a',
                background: source === initialSource ? '#94a3b8' : '#E6CE7E',
                border: 'none',
                padding: '4px 14px',
                borderRadius: 6,
                cursor: saving || source === initialSource ? 'not-allowed' : 'pointer',
                fontWeight: 700,
                letterSpacing: '0.04em'
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      </div>

      {/* Body — preview or textarea */}
      {!editing && children}
      {editing && (
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck
          disabled={saving}
          style={{
            display: 'block',
            width: '100%',
            maxWidth: 880,
            margin: '0 auto',
            minHeight: 'calc(100vh - 240px)',
            padding: '24px 28px',
            background: '#FFFFFF',
            border: '1px solid rgba(10,77,60,0.32)',
            borderRadius: 8,
            fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--ink, #14201B)',
            resize: 'vertical',
            outline: 'none'
          }}
        />
      )}
    </>
  );
}
