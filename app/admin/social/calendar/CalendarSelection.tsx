'use client';

/**
 * Calendar bulk-selection layer. A client context wraps the (server-rendered)
 * calendar; each TimelineEntry can register a checkbox that toggles its
 * outbox id into the shared selection. A floating BulkBar appears when anything
 * is selected and runs the action across all of them — reusing the existing
 * single-item DELETE endpoint, so no new server plumbing.
 *
 * This is the first slice of the interaction layer (bulk delete). Reschedule /
 * inline edit hang off the same selection next.
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

interface SelectionCtx {
  selected: Set<number>;
  toggle: (id: number) => void;
  clear: () => void;
}

const Ctx = createContext<SelectionCtx | null>(null);

/** Null when used outside the provider (so entries degrade to no-checkbox). */
export function useCalendarSelection(): SelectionCtx | null {
  return useContext(Ctx);
}

export function CalendarSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggle = useCallback((id: number) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Set()), []);
  return (
    <Ctx.Provider value={{ selected, toggle, clear }}>
      {children}
      <BulkBar />
    </Ctx.Provider>
  );
}

function BulkBar() {
  const ctx = useContext(Ctx);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [when, setWhen] = useState('');
  if (!ctx || ctx.selected.size === 0) return null;
  const count = ctx.selected.size;

  async function deleteSelected() {
    if (!ctx) return;
    if (!confirm(`Delete ${count} scheduled item${count === 1 ? '' : 's'}? This cancels and removes them from the calendar.`)) return;
    setBusy(true); setMsg(null);
    const ids = [...ctx.selected];
    const results = await Promise.allSettled(
      ids.map((id) => fetch(`/api/admin/social/publish/${id}`, { method: 'DELETE' }))
    );
    const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as Response).ok).length;
    ctx.clear();
    setBusy(false);
    setMsg(`Removed ${ok} of ${ids.length}.`);
    router.refresh();
  }

  async function rescheduleSelected() {
    if (!ctx || !when) return;
    const iso = new Date(when).toISOString();
    setBusy(true); setMsg(null);
    const ids = [...ctx.selected];
    const results = await Promise.allSettled(
      ids.map((id) => fetch(`/api/admin/social/publish/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scheduledFor: iso })
      }))
    );
    const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as Response).ok).length;
    ctx.clear(); setWhen('');
    setBusy(false);
    setMsg(`Rescheduled ${ok} of ${ids.length}.`);
    router.refresh();
  }

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 flex items-center gap-2 rounded-full px-4 py-2.5 shadow-2xl flex-wrap justify-center"
      style={{ background: '#0e1420', border: '1px solid rgba(255,255,255,0.14)' }}
    >
      <span className="text-sm text-ink mr-1"><strong>{count}</strong> selected</span>
      <input
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        className="rounded-lg px-2 py-1 text-xs"
        style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.16)', color: '#e2e8f0' }}
        aria-label="New date and time for selected posts"
      />
      <button
        type="button"
        onClick={rescheduleSelected}
        disabled={busy || !when}
        className="rounded-full px-3 py-1.5 text-sm font-medium"
        style={{ background: 'rgba(59,130,246,0.18)', color: '#93c5fd', opacity: busy || !when ? 0.5 : 1 }}
      >
        Reschedule
      </button>
      <button
        type="button"
        onClick={deleteSelected}
        disabled={busy}
        className="rounded-full px-3 py-1.5 text-sm font-medium"
        style={{ background: 'rgba(239,68,68,0.18)', color: '#fca5a5', opacity: busy ? 0.5 : 1 }}
      >
        {busy ? 'Working…' : 'Delete'}
      </button>
      <button type="button" onClick={() => ctx.clear()} className="text-sm text-muted hover:text-ink">Clear</button>
      {msg && <span className="text-xs text-muted w-full text-center">{msg}</span>}
    </div>
  );
}
