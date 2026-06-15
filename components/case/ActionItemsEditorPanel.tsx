'use client';

/**
 * ActionItemsEditorPanel  (val 2026-06-14, #632)
 *
 * Operator-only editor for case_action_items. Replaces the SQL workflow val
 * was using to rewrite Options A–E on the Johnson trust matter.
 *
 * Mounts inside the existing dark "Action items" section on
 * /admin/av/clients/[clientId]/cases/[caseId]/page.tsx — the section header
 * + count stay where they are; this panel renders inside.
 *
 * Capabilities:
 *   - Inline edit (title, detail, status, priority, visibility, due_date)
 *   - Add new action item at top via inline form
 *   - Delete with confirm
 *   - Visibility toggle: parents_safe vs operator_only (#635 visibility filter)
 *
 * Server data comes from loadFullCase().actionItems; refresh strategy is
 * router.refresh() after each mutation so the Server Component re-runs.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CaseActionItem } from '@/lib/case/case_store';

interface Props {
  caseId: number;
  initialItems: CaseActionItem[];
}

type Priority = 'low' | 'normal' | 'high' | 'urgent';
type Status = 'open' | 'in_progress' | 'done' | 'blocked';
type Visibility = 'parents_safe' | 'operator_only';

const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent'];
const STATUSES: Status[] = ['open', 'in_progress', 'done', 'blocked'];

interface DraftItem {
  title: string;
  detail: string;
  priority: Priority;
  status: Status;
  visibility: Visibility;
  dueDate: string;
}

function emptyDraft(): DraftItem {
  return {
    title: '',
    detail: '',
    priority: 'normal',
    status: 'open',
    visibility: 'parents_safe',
    dueDate: ''
  };
}

function toDraft(a: CaseActionItem): DraftItem {
  return {
    title: a.title,
    detail: a.detail || '',
    priority: (a.priority as Priority) || 'normal',
    status: (a.status as Status) || 'open',
    visibility: a.visibility || 'parents_safe',
    dueDate: a.dueDate ? a.dueDate.slice(0, 10) : ''
  };
}

export default function ActionItemsEditorPanel({ caseId, initialItems }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftItem>(emptyDraft());
  const [addingNew, setAddingNew] = useState(false);
  const [newDraft, setNewDraft] = useState<DraftItem>(emptyDraft());
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  function startEdit(a: CaseActionItem) {
    setEditingId(a.actionId);
    setDraft(toDraft(a));
    setErr(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft());
    setErr(null);
  }

  async function saveEdit(actionId: number) {
    setErr(null);
    setBusyId(actionId);
    try {
      const res = await fetch(
        `/api/admin/av/cases/${caseId}/actions/${actionId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draft.title,
            detail: draft.detail || null,
            priority: draft.priority,
            status: draft.status,
            visibility: draft.visibility,
            dueDate: draft.dueDate || null
          })
        }
      );
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

  async function deleteItem(actionId: number, title: string) {
    if (!confirm(`Delete "${title}"?\n\nThis can't be undone. Notes attached to this action item are deleted too.`)) {
      return;
    }
    setErr(null);
    setBusyId(actionId);
    try {
      const res = await fetch(
        `/api/admin/av/cases/${caseId}/actions/${actionId}`,
        { method: 'DELETE' }
      );
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
    if (!newDraft.title.trim()) {
      setErr('Title is required.');
      return;
    }
    setErr(null);
    try {
      const res = await fetch(
        `/api/admin/av/cases/${caseId}/actions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: newDraft.title.trim(),
            detail: newDraft.detail || null,
            priority: newDraft.priority,
            dueDate: newDraft.dueDate || null
          })
        }
      );
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || 'create failed');
      startTransition(() => {
        setAddingNew(false);
        setNewDraft(emptyDraft());
        router.refresh();
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'create failed');
    }
  }

  return (
    <div className="space-y-3">
      {/* Add-new toggle row */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">
          {initialItems.length} item{initialItems.length === 1 ? '' : 's'}
        </span>
        {!addingNew && (
          <button
            type="button"
            onClick={() => { setAddingNew(true); setNewDraft(emptyDraft()); setErr(null); }}
            className="text-xs px-2 py-1 rounded border border-emerald-700/40 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-900/50 transition-colors"
          >
            + Add action item
          </button>
        )}
      </div>

      {err && (
        <div className="text-xs text-red-300 bg-red-900/20 border border-red-700/40 rounded p-2">
          {err}
        </div>
      )}

      {/* New action form */}
      {addingNew && (
        <div className="border border-emerald-700/30 bg-emerald-950/20 rounded-lg p-3 space-y-2">
          <input
            type="text"
            placeholder="What needs to happen?"
            value={newDraft.title}
            onChange={(e) => setNewDraft({ ...newDraft, title: e.target.value })}
            className="w-full bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-sm"
            autoFocus
          />
          <textarea
            placeholder="Detail (supports paragraphs)"
            value={newDraft.detail}
            onChange={(e) => setNewDraft({ ...newDraft, detail: e.target.value })}
            rows={3}
            className="w-full bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-xs font-mono"
          />
          <div className="flex flex-wrap gap-2 text-xs">
            <label className="flex items-center gap-1 text-muted">
              Priority
              <select
                value={newDraft.priority}
                onChange={(e) => setNewDraft({ ...newDraft, priority: e.target.value as Priority })}
                className="bg-[var(--surface-1)] border border-border rounded px-1.5 py-1 text-xs"
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1 text-muted">
              Due
              <input
                type="date"
                value={newDraft.dueDate}
                onChange={(e) => setNewDraft({ ...newDraft, dueDate: e.target.value })}
                className="bg-[var(--surface-1)] border border-border rounded px-1.5 py-1 text-xs"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setAddingNew(false); setNewDraft(emptyDraft()); setErr(null); }}
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
              {isPending ? 'Saving…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Item list */}
      {initialItems.length === 0 && !addingNew ? (
        <div className="text-sm text-muted italic">No action items yet.</div>
      ) : (
        <ul className="space-y-3 text-sm">
          {initialItems.map((a) => {
            const isEditing = editingId === a.actionId;
            const busy = busyId === a.actionId;
            return (
              <li
                key={a.actionId}
                className="border-b border-border pb-2 last:border-0"
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      className="w-full bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-sm font-medium"
                    />
                    <textarea
                      value={draft.detail}
                      onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
                      rows={6}
                      placeholder="Detail (supports paragraphs; line breaks render on family view)"
                      className="w-full bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-xs font-mono whitespace-pre-wrap"
                    />
                    <div className="flex flex-wrap gap-2 text-xs">
                      <label className="flex items-center gap-1 text-muted">
                        Status
                        <select
                          value={draft.status}
                          onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}
                          className="bg-[var(--surface-1)] border border-border rounded px-1.5 py-1 text-xs"
                        >
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <label className="flex items-center gap-1 text-muted">
                        Priority
                        <select
                          value={draft.priority}
                          onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}
                          className="bg-[var(--surface-1)] border border-border rounded px-1.5 py-1 text-xs"
                        >
                          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </label>
                      <label className="flex items-center gap-1 text-muted">
                        Visibility
                        <select
                          value={draft.visibility}
                          onChange={(e) => setDraft({ ...draft, visibility: e.target.value as Visibility })}
                          className="bg-[var(--surface-1)] border border-border rounded px-1.5 py-1 text-xs"
                        >
                          <option value="parents_safe">Family sees it</option>
                          <option value="operator_only">Operator only</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-1 text-muted">
                        Due
                        <input
                          type="date"
                          value={draft.dueDate}
                          onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
                          className="bg-[var(--surface-1)] border border-border rounded px-1.5 py-1 text-xs"
                        />
                      </label>
                    </div>
                    <div className="flex justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => deleteItem(a.actionId, a.title)}
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
                          onClick={() => saveEdit(a.actionId)}
                          className="text-xs px-3 py-1 rounded bg-emerald-900/50 text-emerald-200 border border-emerald-700/50 hover:bg-emerald-900/70 transition-colors"
                          disabled={busy || isPending}
                        >
                          {busy || isPending ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="group">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex-1 font-medium">{a.title}</div>
                      <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${priorityPill(a.priority)}`}>
                        {a.priority}
                      </span>
                    </div>
                    {a.detail && (
                      <div className="text-xs text-muted whitespace-pre-wrap">{a.detail}</div>
                    )}
                    <div className="text-xs text-muted mt-1 flex items-center gap-2 flex-wrap">
                      <span>{a.status}</span>
                      {a.dueDate && <span>· due {formatDate(a.dueDate)}</span>}
                      <span className={`text-[9px] uppercase tracking-wider px-1 py-0.5 rounded ${
                        a.visibility === 'operator_only'
                          ? 'bg-[var(--surface-3)] text-amber-300 border border-amber-700/40'
                          : 'bg-emerald-900/20 text-emerald-300 border border-emerald-700/30'
                      }`}>
                        {a.visibility === 'operator_only' ? 'Operator only' : 'Family sees it'}
                      </span>
                      <button
                        type="button"
                        onClick={() => startEdit(a)}
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
        </ul>
      )}
    </div>
  );
}

function priorityPill(p: string): string {
  const styles: Record<string, string> = {
    urgent: 'bg-red-900/30 text-red-300 border-red-700/40',
    high: 'bg-amber-900/30 text-amber-300 border-amber-700/40',
    normal: 'bg-[var(--surface-3)] text-muted border-border',
    low: 'bg-[var(--surface-3)] text-muted border-border'
  };
  return styles[p] || styles.normal;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}
