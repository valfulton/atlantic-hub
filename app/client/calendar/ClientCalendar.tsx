'use client';
/**
 * ClientCalendar — the client's full social calendar (val 2026-06-05: "go max").
 * Month + week views, holidays + important-dates layers, and DRAG-TO-RESCHEDULE
 * of the client's own queued posts. Cream/pop palette, all color via tokens.
 *
 * Reuses the real engine: items come from the page's tenant-scoped social_outbox
 * load (lib timeline shape); holidays from lib/calendar/holidays; important dates
 * passed in from getImportantDatesForWindow. Drag writes through the client-scoped
 * endpoint /api/client/social/outbox/[id]/reschedule (own rows only, publish gate
 * untouched). DnD is disabled in the operator preview mirror (`preview`).
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { holidayMap } from '@/lib/calendar/holidays';

export interface CalItem {
  id: string;
  outboxId: number | null;
  reschedulable: boolean;
  whenISO: string | null;
  kind: 'queued' | 'draft';
  channel: string | null;
  title: string;
  detail: string | null;
}
export interface CalImportantDate { iso: string; label: string; kind?: string }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfDay(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d: Date, n: number): Date { const x = startOfDay(d); x.setDate(x.getDate() + n); return x; }

export default function ClientCalendar({
  items,
  importantDates = [],
  preview = false
}: {
  items: CalItem[];
  importantDates?: CalImportantDate[];
  preview?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<'month' | 'week'>('month');
  const initial = useMemo(() => {
    const dated = items.map((i) => i.whenISO).filter(Boolean).sort() as string[];
    const base = dated.length ? new Date(dated[0]) : new Date();
    return startOfDay(base);
  }, [items]);
  const [anchor, setAnchor] = useState(initial);
  const [drag, setDrag] = useState<number | null>(null);
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  // Optimistic date overrides {outboxId: iso} so a dropped post jumps instantly.
  const [moved, setMoved] = useState<Record<number, string>>({});

  const byDay = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    for (const it of items) {
      const o = it.outboxId != null ? moved[it.outboxId] : undefined;
      const key = o ?? (it.whenISO ? iso(new Date(it.whenISO)) : null);
      if (!key) continue;
      const arr = m.get(key);
      if (arr) arr.push(it); else m.set(key, [it]);
    }
    return m;
  }, [items, moved]);

  const importantByDay = useMemo(() => {
    const m = new Map<string, CalImportantDate[]>();
    for (const d of importantDates) {
      const arr = m.get(d.iso);
      if (arr) arr.push(d); else m.set(d.iso, [d]);
    }
    return m;
  }, [importantDates]);

  // Build the visible cells.
  const todayKey = iso(new Date());
  let cells: Date[];
  let title: string;
  if (view === 'week') {
    const ws = addDays(anchor, -anchor.getDay());
    cells = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    title = `Week of ${cells[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  } else {
    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = addDays(monthStart, -monthStart.getDay());
    cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    title = `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
  }
  const holidays = useMemo(() => holidayMap(Array.from(new Set(cells.map((c) => c.getFullYear())))), [cells]);

  function shift(n: number) {
    setAnchor(view === 'week' ? addDays(anchor, 7 * n) : new Date(anchor.getFullYear(), anchor.getMonth() + n, 1));
  }
  function toToday() { setAnchor(startOfDay(new Date())); }

  async function drop(targetIso: string) {
    const id = drag;
    setDrag(null);
    setHoverDay(null);
    if (id == null || preview) return;
    setMoved((m) => ({ ...m, [id]: targetIso })); // optimistic
    try {
      const res = await fetch(`/api/client/social/outbox/${id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledFor: `${targetIso}T12:00:00` })
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) { setToast(`Moved to ${targetIso}`); router.refresh(); }
      else { setMoved((m) => { const n = { ...m }; delete n[id]; return n; }); setToast(j.error || 'Could not move that one'); }
    } catch {
      setMoved((m) => { const n = { ...m }; delete n[id]; return n; });
      setToast('Network error — try again');
    } finally {
      setTimeout(() => setToast(''), 2400);
    }
  }

  return (
    <div className="cal">
      <div className="cal-bar">
        <button type="button" className="cal-bar__nav" aria-label="Previous" onClick={() => shift(-1)}>‹</button>
        <button type="button" className="cal-bar__nav" onClick={toToday}>Today</button>
        <button type="button" className="cal-bar__nav" aria-label="Next" onClick={() => shift(1)}>›</button>
        <span className="cal-bar__label">{title}</span>
        <span className="cal-bar__views">
          <button type="button" className={`cal-bar__view ${view === 'month' ? 'on' : ''}`} onClick={() => setView('month')}>Month</button>
          <button type="button" className={`cal-bar__view ${view === 'week' ? 'on' : ''}`} onClick={() => setView('week')}>Week</button>
        </span>
      </div>

      <div className="cal-head" aria-hidden="true">
        {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
      </div>

      <div
        className={`cal-grid ${view === 'week' ? 'cal-grid--week' : ''}`}
        role="grid"
        aria-label="Content calendar"
        onDragOver={(e) => { if (drag != null) { const c = (e.target as HTMLElement).closest('[data-cal-date]'); if (c) { e.preventDefault(); setHoverDay(c.getAttribute('data-cal-date')); } } }}
        onDrop={(e) => { const c = (e.target as HTMLElement).closest('[data-cal-date]') as HTMLElement | null; if (c) { e.preventDefault(); const d = c.getAttribute('data-cal-date'); if (d) drop(d); } }}
      >
        {cells.map((d) => {
          const key = iso(d);
          const inMonth = view === 'week' || d.getMonth() === anchor.getMonth();
          const dayItems = byDay.get(key) ?? [];
          const shown = dayItems.slice(0, view === 'week' ? 8 : 3);
          const hol = holidays.get(key);
          const imp = importantByDay.get(key);
          return (
            <div
              key={key}
              data-cal-date={key}
              role="gridcell"
              className={`cal-cell${inMonth ? '' : ' cal-cell--out'}${key === todayKey ? ' cal-cell--today' : ''}${hoverDay === key ? ' cal-cell--drop' : ''}`}
            >
              <span className="cal-cell__d">{d.getDate()}</span>
              {hol && <span className="cal-hol" title={hol.name}>{hol.emoji} {hol.name}</span>}
              {imp?.map((x, i) => <span key={i} className="cal-imp" title={x.label}>{x.label}</span>)}
              <div className="cal-cell__items">
                {shown.map((it) => {
                  const canDrag = !preview && it.reschedulable && it.outboxId != null;
                  return (
                    <span
                      key={it.id}
                      className={`cal-item cal-item--${it.kind}${canDrag ? ' cal-item--drag' : ''}`}
                      title={`${it.title}${canDrag ? ' · drag to reschedule' : ''}`}
                      draggable={canDrag}
                      onDragStart={canDrag ? () => setDrag(it.outboxId) : undefined}
                      onDragEnd={() => { setDrag(null); setHoverDay(null); }}
                    >
                      {it.title}
                    </span>
                  );
                })}
                {dayItems.length > shown.length && <span className="cal-more">+{dayItems.length - shown.length}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="cal-legend">
        <span><i className="cal-item--queued" /> Queued to post</span>
        <span><i className="cal-item--draft" /> Draft · needs you</span>
        {!preview && <span className="cal-legend__hint">Drag a post to a new day to reschedule</span>}
      </div>

      {toast && <div className="cal-toast" role="status">{toast}</div>}
    </div>
  );
}
