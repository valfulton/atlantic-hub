/**
 * components/case/ActionItemNotesPanel.tsx
 *
 * Append-only conversation thread on a single action item. Anyone with case
 * access (operator + client_user collaborators) can read + write. New notes
 * are persisted via POST /api/admin/av/cases/[caseId]/actions/[actionId]/notes
 * which also enforces the access gate.
 *
 * Renders existing notes with author + timestamp, and any §X.Y references in
 * the note body get wrapped as deep-links into the trust PDF (same mechanism
 * as the synopsis + action-item detail).
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SectionText from './SectionText';

interface NoteLite {
  noteId: number;
  actionId: number;
  body: string;
  authorRole: 'owner' | 'staff' | 'client_user';
  authorUserId: number;
  authorDisplayName: string | null;
  createdAt: string | null;
}

interface Props {
  caseId: number;
  actionId: number;
  initialNotes: NoteLite[];
  sectionDocUrl: string | null;
  sectionIndex: Record<string, number> | null;
}

function formatTs(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch { return iso; }
}

function roleLabel(r: string): string {
  switch (r) {
    case 'owner': return 'Atlantic & Vine';
    case 'staff': return 'Atlantic & Vine';
    case 'client_user': return 'Family / counsel';
    default: return r;
  }
}

export default function ActionItemNotesPanel({
  caseId,
  actionId,
  initialNotes,
  sectionDocUrl,
  sectionIndex
}: Props) {
  const router = useRouter();
  const [notes, setNotes] = useState<NoteLite[]>(initialNotes);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handlePost() {
    const text = body.trim();
    if (!text) return;
    setPosting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/av/cases/${caseId}/actions/${actionId}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: text })
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setErr(data?.error || 'post failed');
        return;
      }
      // Refresh the list. Use server refresh to get the canonical row back
      // (with the assigned noteId + server-side createdAt).
      setBody('');
      router.refresh();
      // Optimistic: push a temp row so the user sees their write immediately.
      setNotes((prev) => [
        ...prev,
        {
          noteId: data.noteId,
          actionId,
          body: text,
          authorRole: 'owner',
          authorUserId: 0,
          authorDisplayName: 'You',
          createdAt: new Date().toISOString()
        }
      ]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'network error');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="space-y-4">
      {notes.length === 0 ? (
        <div className="text-sm text-muted italic">
          No notes yet. Drop the first comment to start the thread.
        </div>
      ) : (
        <ol className="space-y-3">
          {notes.map((n) => (
            <li key={n.noteId} className="rounded-md border border-border bg-black/15 p-3">
              <div className="flex items-baseline gap-2 mb-1 text-[11px] text-muted">
                <span className="font-medium text-ink">
                  {n.authorDisplayName || roleLabel(n.authorRole)}
                </span>
                <span>·</span>
                <span>{roleLabel(n.authorRole)}</span>
                <span>·</span>
                <span>{formatTs(n.createdAt)}</span>
              </div>
              <div className="text-sm whitespace-pre-wrap leading-relaxed">
                <SectionText
                  text={n.body}
                  documentUrl={sectionDocUrl}
                  sectionIndex={sectionIndex}
                />
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* Composer */}
      <div className="pt-3 border-t border-border">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Add a note. § references like §6.G(2) will deep-link automatically."
          className="w-full bg-black/30 border border-border rounded px-2 py-1.5 text-sm leading-relaxed"
        />
        <div className="flex items-center gap-3 mt-2">
          <button
            type="button"
            onClick={handlePost}
            disabled={!body.trim() || posting}
            className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-emerald-700 text-white disabled:opacity-50"
          >
            {posting ? 'Posting…' : 'Add note'}
          </button>
          {err && <span className="text-xs text-red-300">{err}</span>}
        </div>
      </div>
    </div>
  );
}
