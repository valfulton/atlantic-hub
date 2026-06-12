/**
 * components/case/ActionItemEditor.tsx
 *
 * Operator/staff inline editor for an action item. PATCHes
 * /api/admin/av/cases/[caseId]/actions/[actionId] and reloads on success.
 *
 * Client-only — no client_user role should mount this component. The mirror
 * client page renders status changes through a lighter version (caregiver can
 * mark done / blocked, can't edit body).
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  caseId: number;
  actionId: number;
  initial: {
    title: string;
    detail: string | null;
    status: string;
    priority: string;
    dueDate: string | null;
  };
}

const STATUSES = ['open', 'in_progress', 'done', 'blocked'] as const;
const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;

export default function ActionItemEditor({ caseId, actionId, initial }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [detail, setDetail] = useState(initial.detail ?? '');
  const [status, setStatus] = useState(initial.status);
  const [priority, setPriority] = useState(initial.priority);
  const [dueDate, setDueDate] = useState(initial.dueDate?.slice(0, 10) ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const dirty =
    title !== initial.title ||
    detail !== (initial.detail ?? '') ||
    status !== initial.status ||
    priority !== initial.priority ||
    (dueDate || '') !== (initial.dueDate?.slice(0, 10) ?? '');

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/cases/${caseId}/actions/${actionId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          detail: detail.trim() || null,
          status,
          priority,
          dueDate: dueDate || null
        })
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setMsg(data?.error || 'save failed');
        return;
      }
      setMsg('saved');
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="text-xs block">
        <span className="block text-muted uppercase tracking-wider mb-1">Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-black/30 border border-border rounded px-2 py-1.5 text-sm"
        />
      </label>
      <label className="text-xs block">
        <span className="block text-muted uppercase tracking-wider mb-1">Detail (§ references will link)</span>
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={5}
          className="w-full bg-black/30 border border-border rounded px-2 py-1.5 text-sm leading-relaxed"
        />
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className="text-xs">
          <span className="block text-muted uppercase tracking-wider mb-1">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full bg-black/30 border border-border rounded px-2 py-1.5 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-muted uppercase tracking-wider mb-1">Priority</span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full bg-black/30 border border-border rounded px-2 py-1.5 text-sm"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-muted uppercase tracking-wider mb-1">Due date</span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full bg-black/30 border border-border rounded px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-emerald-700 text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {msg && (
          <span className={`text-xs ${msg === 'saved' ? 'text-emerald-300' : 'text-red-300'}`}>
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}
