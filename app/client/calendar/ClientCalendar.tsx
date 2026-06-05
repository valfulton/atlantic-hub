'use client';
/**
 * ClientCalendar — cream, token-driven month grid for /client/calendar (and its
 * operator preview mirror). Read-only: shows queued posts + drafts awaiting
 * review on the day they're scheduled/created. Reuses the page's existing
 * client-scoped data loader (social_outbox + content_artifacts) — only the
 * presentation is new. All colors are semantic tokens (no inline hex), so a
 * palette retune is one file. Drag-to-reschedule + composer stay operator-only.
 */
import { useMemo, useState } from 'react';

export interface CalItem {
  id: string;
  whenISO: string | null;
  kind: 'queued' | 'draft';
  channel: string | null;
  title: string;
  detail: string | null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ClientCalendar({ items }: { items: CalItem[] }) {
  // Anchor on the month containing the soonest item, else today.
  const initial = useMemo(() => {
    const dated = items.map((i) => i.whenISO).filter(Boolean).sort() as string[];
    const base = dated.length ? new Date(dated[0]) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  }, [items]);
  const [anchor, setAnchor] = useState(initial);

  const byDay = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    for (const it of items) {
      if (!it.whenISO) continue;
      const key = iso(new Date(it.whenISO));
      const arr = m.get(key);
      if (arr) arr.push(it);
      else m.set(key, [it]);
    }
    return m;
  }, [items]);

  const todayKey = iso(new Date());
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(1 - monthStart.getDay()); // back to the Sunday on/before the 1st
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  const shift = (n: number) => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + n, 1));
  const toToday = () => { const t = new Date(); setAnchor(new Date(t.getFullYear(), t.getMonth(), 1)); };

  return (
    <div className="cal">
      <div className="cal-bar">
        <button type="button" className="cal-bar__nav" aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
        <button type="button" className="cal-bar__nav" onClick={toToday}>Today</button>
        <button type="button" className="cal-bar__nav" aria-label="Next month" onClick={() => shift(1)}>›</button>
        <span className="cal-bar__label">{MONTHS[anchor.getMonth()]} {anchor.getFullYear()}</span>
      </div>

      <div className="cal-head" aria-hidden="true">
        {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
      </div>

      <div className="cal-grid" role="grid" aria-label="Content calendar">
        {cells.map((d) => {
          const key = iso(d);
          const inMonth = d.getMonth() === anchor.getMonth();
          const dayItems = byDay.get(key) ?? [];
          const shown = dayItems.slice(0, 3);
          return (
            <div
              key={key}
              role="gridcell"
              className={`cal-cell${inMonth ? '' : ' cal-cell--out'}${key === todayKey ? ' cal-cell--today' : ''}`}
            >
              <span className="cal-cell__d">{d.getDate()}</span>
              <div className="cal-cell__items">
                {shown.map((it) => (
                  <span
                    key={it.id}
                    className={`cal-item cal-item--${it.kind}`}
                    title={`${it.title}${it.detail ? ` — ${it.detail}` : ''}`}
                  >
                    {it.title}
                  </span>
                ))}
              </div>
              {dayItems.length > shown.length && (
                <span className="cal-more">+{dayItems.length - shown.length} more</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="cal-legend">
        <span><i className="cal-item--queued" /> Queued to post</span>
        <span><i className="cal-item--draft" /> Draft · needs your review</span>
      </div>
    </div>
  );
}
