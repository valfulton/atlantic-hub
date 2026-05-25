'use client';

/**
 * CalendarDnD — drag-to-reschedule layer for the Campaign Timeline.
 *
 * Wraps the (server-rendered) calendar grid and uses event delegation: a small
 * drag handle on each schedulable social item carries data-outbox-id; each day
 * cell carries data-cal-date. Dropping a handle on a day PATCHes the post's
 * scheduled_for to that day (noon) and refreshes. Only the handle is draggable,
 * so it never interferes with the item card's buttons/inputs. Operator-only.
 */
import { useRef, useState, type ReactNode, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';

export function CalendarDnD({ children }: { children: ReactNode }) {
  const router = useRouter();
  const dragId = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function onDragStart(e: DragEvent) {
    const el = (e.target as HTMLElement).closest('[data-outbox-id]') as HTMLElement | null;
    if (!el) return;
    const id = Number(el.getAttribute('data-outbox-id'));
    if (Number.isFinite(id) && id > 0) {
      dragId.current = id;
      e.dataTransfer.setData('text/plain', String(id));
      e.dataTransfer.effectAllowed = 'move';
    }
  }

  function onDragOver(e: DragEvent) {
    if (dragId.current == null) return;
    const cell = (e.target as HTMLElement).closest('[data-cal-date]');
    if (cell) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  }

  async function onDrop(e: DragEvent) {
    const cell = (e.target as HTMLElement).closest('[data-cal-date]') as HTMLElement | null;
    const id = Number(e.dataTransfer.getData('text/plain')) || dragId.current;
    dragId.current = null;
    if (!cell || !id) return;
    const date = cell.getAttribute('data-cal-date');
    if (!date) return;
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const scheduledFor = new Date(`${date}T12:00:00`).toISOString();
      const res = await fetch(`/api/admin/social/publish/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledFor })
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) { setMsg({ ok: true, text: 'Moved to ' + date }); router.refresh(); }
      else setMsg({ ok: false, text: j.error || 'Could not reschedule.' });
    } catch {
      setMsg({ ok: false, text: 'Could not reschedule.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}>
      {(busy || msg) && (
        <div className="mb-2 text-xs" aria-live="polite">
          {busy ? <span className="text-muted">Rescheduling…</span> : msg && <span className={msg.ok ? 'text-emerald-300' : 'text-rose-300'}>{msg.text}</span>}
        </div>
      )}
      {children}
    </div>
  );
}
