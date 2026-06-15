'use client';

/**
 * SynopsisEditor  (val 2026-06-15, #682)
 *
 * Operator inline-edit on the case synopsis (cases.case_synopsis).
 * Mounts inside the existing "Synopsis" section on the operator case
 * page. Reading mode renders the current synopsis with section-text
 * passthrough; editing mode replaces it with a textarea + Save/Cancel.
 *
 * Lives next to the ActionItemsEditorPanel from #632 — same pattern,
 * same SQL-killer goal.
 *
 * PATCH /api/admin/av/cases/[caseId] with { caseSynopsis }.
 */

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  caseId: number;
  initialSynopsis: string | null;
  /** Render-time prose component (e.g. SectionText) so links to the trust
   *  PDF keep working in view mode. The editor only swaps in editable mode. */
  readView: ReactNode;
}

export default function SynopsisEditor({ caseId, initialSynopsis, readView }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(initialSynopsis || '');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraft(initialSynopsis || '');
    setErr(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setErr(null);
    setDraft(initialSynopsis || '');
  }

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/av/cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseSynopsis: draft })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || 'save failed');
      startTransition(() => {
        setEditing(false);
        router.refresh();
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div>
        <div className="text-sm whitespace-pre-wrap leading-relaxed">{readView}</div>
        <button
          type="button"
          onClick={startEdit}
          className="mt-3 text-[11px] uppercase tracking-wider text-emerald-300 hover:text-emerald-200"
        >
          Edit synopsis
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.max(6, Math.min(20, draft.split('\n').length + 2))}
        placeholder="One paragraph that captures the case for family + counsel."
        className="w-full bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-sm leading-relaxed whitespace-pre-wrap"
        autoFocus
      />
      {err && (
        <div className="text-xs text-red-300 bg-red-900/20 border border-red-700/40 rounded p-2">
          {err}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={cancel}
          className="text-xs px-2 py-1 text-muted hover:text-white"
          disabled={saving || isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className="text-xs px-3 py-1 rounded bg-emerald-900/50 text-emerald-200 border border-emerald-700/50 hover:bg-emerald-900/70 transition-colors"
          disabled={saving || isPending}
        >
          {saving || isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
