'use client';

/**
 * TimelineEditorPanel  (val 2026-06-15, #682)
 *
 * Operator-only inline edit / delete / add on the case timeline
 * (case_events). Mirrors the ActionItemsEditorPanel pattern from #632 —
 * same SQL-killer goal. Lives inside the "Timeline" section on
 * /admin/av/clients/[clientId]/cases/[caseId]/page.tsx.
 *
 * Schema columns on case_events:
 *   event_id · event_date · event_kind · event_title · event_detail
 *   source · source_uri
 * (No visibility column — every event renders to every viewer who can
 * see the case. Sensitive log entries belong in case_action_items where
 * visibility lives.)
 *
 * Endpoints:
 *   POST    /api/admin/av/cases/[caseId]/events            (add)
 *   PATCH   /api/admin/av/cases/[caseId]/events/[eventId]  (edit)
 *   DELETE  /api/admin/av/cases/[caseId]/events/[eventId]  (delete)
 */

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { CaseEvent } from '@/lib/case/case_store';

interface Props {
  caseId: number;
  initialEvents: CaseEvent[];
  /**
   * (val 2026-06-15) Server-component pre-rendered SectionText nodes per
   * eventId — preserves §-ref clickability that #663 added. Map key is
   * the event_id. Missing entries fall back to whitespace-pre-wrap text.
   * Pass {} if you don't need section linking.
   */
  renderedDetails?: Record<number, ReactNode>;
}

interface Draft {
  eventDate: string;     // YYYY-MM-DD
  eventKind: string;
  eventTitle: string;
  eventDetail: string;
  source: string;
  sourceUri: string;
}

function emptyDraft(): Draft {
  return {
    eventDate: new Date().toISOString().slice(0, 10),
    eventKind: '',
    eventTitle: '',
    eventDetail: '',
    source: '',
    sourceUri: ''
  };
}

function toDraft(e: CaseEvent): Draft {
  return {
    eventDate: (e.eventDate || '').slice(0, 10),
    eventKind: e.eventKind || '',
    eventTitle: e.eventTitle || '',
    eventDetail: e.eventDetail || '',
    source: e.source || '',
    sourceUri: e.sourceUri || ''
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function TimelineEditorPanel({ caseId, initialEvents, renderedDetails }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<Draft>(emptyDraft());
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  function startEdit(e: CaseEvent) {
    setEditingId(e.eventId);
    setDraft(toDraft(e));
    setErr(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft());
    setErr(null);
  }

  async function saveEdit(eventId: number) {
    if (!draft.eventTitle.trim()) {
      setErr('Title is required.');
      return;
    }
    setErr(null);
    setBusyId(eventId);
    try {
      const res = await fetch(`/api/admin/av/cases/${caseId}/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventDate: draft.eventDate,
          eventKind: draft.eventKind || null,
          eventTitle: draft.eventTitle.trim(),
          eventDetail: draft.eventDetail || null,
          source: draft.source || null,
          sourceUri: draft.sourceUri || null
        })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || 'save failed');
      startTransition(() => {
        setEditingId(null);
        router.refresh();
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusyId(null);
    }
  }

  async function deleteItem(eventId: number, title: string) {
    if (!confirm(`Delete timeline entry "${title}"?\n\nThis can't be undone.`)) return;
    setErr(null);
    setBusyId(eventId);
    try {
      const res = await fetch(`/api/admin/av/cases/${caseId}/events/${eventId}`, {
        method: 'DELETE'
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || 'delete failed');
      startTransition(() => router.refresh());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setBusyId(null);
    }
  }

  async function createNew() {
    if (!newDraft.eventTitle.trim()) {
      setErr('Title is required.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(newDraft.eventDate)) {
      setErr('Date is required (YYYY-MM-DD).');
      return;
    }
    setErr(null);
    try {
      const res = await fetch(`/api/admin/av/cases/${caseId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventDate: newDraft.eventDate,
          eventKind: newDraft.eventKind || null,
          eventTitle: newDraft.eventTitle.trim(),
          eventDetail: newDraft.eventDetail || null,
          source: newDraft.source || null,
          sourceUri: newDraft.sourceUri || null
        })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || 'create failed');
      startTransition(() => {
        setAdding(false);
        setNewDraft(emptyDraft());
        router.refresh();
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'create failed');
    }
  }

  return (
    <div className="space-y-3">
      {/* Add toggle row */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">
          {initialEvents.length} {initialEvents.length === 1 ? 'entry' : 'entries'}
        </span>
        {!adding && (
          <button
            type="button"
            onClick={() => { setAdding(true); setNewDraft(emptyDraft()); setErr(null); }}
            className="text-xs px-2 py-1 rounded border border-emerald-700/40 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-900/50 transition-colors"
          >
            + Log entry
          </button>
        )}
      </div>

      {err && (
        <div className="text-xs text-red-300 bg-red-900/20 border border-red-700/40 rounded p-2">
          {err}
        </div>
      )}

      {/* New entry form */}
      {adding && (
        <div className="border border-emerald-700/30 bg-emerald-950/20 rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] uppercase tracking-wider text-muted">
              Date
              <input
                type="date"
                value={newDraft.eventDate}
                onChange={(e) => setNewDraft({ ...newDraft, eventDate: e.target.value })}
                className="block w-full mt-0.5 bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-[10px] uppercase tracking-wider text-muted">
              Kind (optional)
              <input
                type="text"
                placeholder="signed · filed · meeting · note"
                value={newDraft.eventKind}
                onChange={(e) => setNewDraft({ ...newDraft, eventKind: e.target.value })}
                className="block w-full mt-0.5 bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-sm"
              />
            </label>
          </div>
          <input
            type="text"
            placeholder="What happened? (one line)"
            value={newDraft.eventTitle}
            onChange={(e) => setNewDraft({ ...newDraft, eventTitle: e.target.value })}
            className="w-full bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-sm font-medium"
            autoFocus
          />
          <textarea
            placeholder="Detail (supports paragraphs)"
            value={newDraft.eventDetail}
            onChange={(e) => setNewDraft({ ...newDraft, eventDetail: e.target.value })}
            rows={3}
            className="w-full bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Source (optional)"
              value={newDraft.source}
              onChange={(e) => setNewDraft({ ...newDraft, source: e.target.value })}
              className="bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-xs"
            />
            <input
              type="url"
              placeholder="Source URL (optional)"
              value={newDraft.sourceUri}
              onChange={(e) => setNewDraft({ ...newDraft, sourceUri: e.target.value })}
              className="bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-xs"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setAdding(false); setNewDraft(emptyDraft()); setErr(null); }}
              className="text-xs px-2 py-1 text-muted hover:text-white"
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={createNew}
              className="text-xs px-3 py-1 rounded bg-emerald-900/50 text-emerald-200 border border-emerald-700/50 hover:bg-emerald-900/70 transition-colors"
              disabled={isPending}
            >
              {isPending ? 'Saving…' : 'Add entry'}
            </button>
          </div>
        </div>
      )}

      {/* Existing entries */}
      {initialEvents.length === 0 && !adding ? (
        <div className="text-sm text-muted italic">No events logged yet.</div>
      ) : (
        <ol className="space-y-3">
          {initialEvents.map((e) => {
            const isEditing = editingId === e.eventId;
            const busy = busyId === e.eventId;
            return (
              <li key={e.eventId} className="border-l-2 border-border pl-3">
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[10px] uppercase tracking-wider text-muted">
                        Date
                        <input
                          type="date"
                          value={draft.eventDate}
                          onChange={(ev) => setDraft({ ...draft, eventDate: ev.target.value })}
                          className="block w-full mt-0.5 bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="text-[10px] uppercase tracking-wider text-muted">
                        Kind
                        <input
                          type="text"
                          value={draft.eventKind}
                          onChange={(ev) => setDraft({ ...draft, eventKind: ev.target.value })}
                          className="block w-full mt-0.5 bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-sm"
                        />
                      </label>
                    </div>
                    <input
                      type="text"
                      value={draft.eventTitle}
                      onChange={(ev) => setDraft({ ...draft, eventTitle: ev.target.value })}
                      className="w-full bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-sm font-medium"
                    />
                    <textarea
                      value={draft.eventDetail}
                      onChange={(ev) => setDraft({ ...draft, eventDetail: ev.target.value })}
                      rows={4}
                      placeholder="Detail"
                      className="w-full bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-xs whitespace-pre-wrap"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Source"
                        value={draft.source}
                        onChange={(ev) => setDraft({ ...draft, source: ev.target.value })}
                        className="bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-xs"
                      />
                      <input
                        type="url"
                        placeholder="Source URL"
                        value={draft.sourceUri}
                        onChange={(ev) => setDraft({ ...draft, sourceUri: ev.target.value })}
                        className="bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-xs"
                      />
                    </div>
                    <div className="flex justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => deleteItem(e.eventId, e.eventTitle)}
                        className="text-[11px] uppercase tracking-wider px-2 py-1 text-red-400 hover:text-red-300"
                        disabled={busy || isPending}
                      >
                        Delete
                      </button>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="text-xs px-2 py-1 text-muted hover:text-white"
                          disabled={busy || isPending}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEdit(e.eventId)}
                          className="text-xs px-3 py-1 rounded bg-emerald-900/50 text-emerald-200 border border-emerald-700/50 hover:bg-emerald-900/70 transition-colors"
                          disabled={busy || isPending}
                        >
                          {busy || isPending ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="text-xs text-muted">
                      {formatDate(e.eventDate)}{e.eventKind ? ` · ${e.eventKind}` : ''}
                    </div>
                    <div className="font-medium text-sm">{e.eventTitle}</div>
                    {e.eventDetail && (
                      <div className="text-xs text-muted mt-1 whitespace-pre-wrap">
                        {renderedDetails && renderedDetails[e.eventId] !== undefined
                          ? renderedDetails[e.eventId]
                          : e.eventDetail}
                      </div>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      {e.sourceUri && (
                        <a href={e.sourceUri} target="_blank" rel="noopener noreferrer" className="text-xs text-brand hover:underline">
                          source →
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => startEdit(e)}
                        className="ml-auto text-[10px] uppercase tracking-wider text-emerald-300 hover:text-emerald-200"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
