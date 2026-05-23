import Link from 'next/link';
import type { TimelineItem, TimelineItemStatus } from '@/lib/pr/types';
import { TimelineEntry } from './TimelineEntry';

interface CalWindow {
  gridStart: Date;
  gridEnd: Date;
  periodStart: Date;
  periodEnd: Date;
}

interface Props {
  view: 'week' | 'month';
  anchor: Date;
  window: CalWindow;
  items: TimelineItem[];
  tenant: string | null;
  tenants: string[];
}

const STATUS_STYLE: Record<TimelineItemStatus, { label: string; bg: string; fg: string }> = {
  draft: { label: 'Draft', bg: 'rgba(148,163,184,0.18)', fg: '#cbd5e1' },
  scheduled: { label: 'Scheduled', bg: 'rgba(59,130,246,0.20)', fg: '#93c5fd' },
  publishing: { label: 'Publishing', bg: 'rgba(245,158,11,0.20)', fg: '#fcd34d' },
  published: { label: 'Published', bg: 'rgba(16,185,129,0.22)', fg: '#6ee7b7' },
  failed: { label: 'Failed', bg: 'rgba(239,68,68,0.20)', fg: '#fca5a5' },
  canceled: { label: 'Canceled', bg: 'rgba(148,163,184,0.12)', fg: '#94a3b8' }
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarView({ view, anchor, window, items, tenant, tenants }: Props) {
  const today = startOfDay(new Date());
  const cellCount = view === 'week' ? 7 : 42;
  const cells: Date[] = [];
  for (let i = 0; i < cellCount; i++) cells.push(addDays(window.gridStart, i));

  // bucket items by ISO date
  const byDate = new Map<string, TimelineItem[]>();
  for (const it of items) {
    const d = new Date(it.when);
    if (Number.isNaN(d.getTime())) continue;
    const key = toIso(startOfDay(d));
    const arr = byDate.get(key) ?? [];
    arr.push(it);
    byDate.set(key, arr);
  }

  const periodLabel =
    view === 'week'
      ? `Week of ${window.periodStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : window.periodStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div>
      {/* nav bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <NavLink href={hrefFor(view, navAnchor(view, anchor, -1), tenant)} label="Previous period">&#8592;</NavLink>
          <NavLink href={hrefFor(view, toIso(today), tenant)} label="Jump to today">Today</NavLink>
          <NavLink href={hrefFor(view, navAnchor(view, anchor, 1), tenant)} label="Next period">&#8594;</NavLink>
          <span className="text-base font-semibold ml-2" style={{ color: '#fff' }}>{periodLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <ToggleLink href={hrefFor('week', toIso(anchor), tenant)} active={view === 'week'}>Week</ToggleLink>
          <ToggleLink href={hrefFor('month', toIso(anchor), tenant)} active={view === 'month'}>Month</ToggleLink>
        </div>
      </div>

      {/* tenant filter */}
      {tenants.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-muted">Brand:</span>
          <TenantChip href={hrefFor(view, toIso(anchor), null)} active={!tenant}>All</TenantChip>
          {tenants.map((t) => (
            <TenantChip key={t} href={hrefFor(view, toIso(anchor), t)} active={tenant === t}>{t}</TenantChip>
          ))}
        </div>
      )}

      {/* weekday header */}
      <div className="grid grid-cols-7 gap-px mb-px">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-[11px] uppercase tracking-wide text-muted px-2 py-1 text-center">{w}</div>
        ))}
      </div>

      {/* grid */}
      <div
        className="grid grid-cols-7 gap-px rounded-lg overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.06)' }}
      >
        {cells.map((day) => {
          const key = toIso(day);
          const dayItems = byDate.get(key) ?? [];
          const inPeriod = day >= window.periodStart && day < window.periodEnd;
          const isToday = key === toIso(today);
          return (
            <div
              key={key}
              className="p-1.5 align-top"
              style={{
                background: inPeriod ? 'rgba(10,10,14,0.85)' : 'rgba(10,10,14,0.45)',
                minHeight: view === 'week' ? 220 : 104,
                outline: isToday ? '1px solid rgba(255,156,91,0.6)' : 'none'
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className="text-[11px]"
                  style={{ color: inPeriod ? '#e5e7eb' : '#6b7280', fontWeight: isToday ? 700 : 400 }}
                >
                  {day.getDate()}
                </span>
                {dayItems.length > 0 && (
                  <span className="text-[10px] text-muted">{dayItems.length}</span>
                )}
              </div>
              <div className="space-y-1">
                {dayItems.slice(0, view === 'week' ? 12 : 4).map((it) => (
                  <TimelineEntry key={it.id} item={it} />
                ))}
                {dayItems.length > (view === 'week' ? 12 : 4) && (
                  <div className="text-[10px] text-muted px-1">+{dayItems.length - (view === 'week' ? 12 : 4)} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 mt-4">
        {(Object.keys(STATUS_STYLE) as TimelineItemStatus[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
            <span className="inline-block w-3 h-3 rounded" style={{ background: STATUS_STYLE[k].bg, border: `1px solid ${STATUS_STYLE[k].fg}` }} />
            {STATUS_STYLE[k].label}
          </span>
        ))}
      </div>

      {items.length === 0 && (
        <p className="text-sm text-muted mt-4">
          Nothing scheduled in this period. Scheduled and published social posts will appear here.
        </p>
      )}
    </div>
  );
}

// ---- small presentational helpers ----------------------------------------

function NavLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="inline-flex items-center justify-center min-w-[36px] h-9 px-3 rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-brand"
      style={{ background: 'rgba(255,255,255,0.06)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.12)' }}
    >
      {children}
    </Link>
  );
}

function ToggleLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-pressed={active}
      className="inline-flex items-center justify-center h-9 px-3 rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-brand"
      style={
        active
          ? { background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 100%)', color: '#1a0a0a', fontWeight: 600 }
          : { background: 'rgba(255,255,255,0.06)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.12)' }
      }
    >
      {children}
    </Link>
  );
}

function TenantChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-pressed={active}
      className="inline-flex items-center h-7 px-3 rounded-full text-[12px] focus-visible:ring-2 focus-visible:ring-brand"
      style={
        active
          ? { background: 'rgba(255,156,91,0.18)', color: '#FFD9BE', border: '1px solid rgba(255,156,91,0.4)' }
          : { background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.1)' }
      }
    >
      {children}
    </Link>
  );
}

// ---- date helpers ----------------------------------------------------------

function hrefFor(view: 'week' | 'month', anchorIso: string, tenant: string | null): string {
  const p = new URLSearchParams();
  p.set('view', view);
  p.set('anchor', anchorIso);
  if (tenant) p.set('tenant', tenant);
  return `/admin/social/calendar?${p.toString()}`;
}

function navAnchor(view: 'week' | 'month', anchor: Date, dir: number): string {
  if (view === 'week') return toIso(addDays(anchor, 7 * dir));
  return toIso(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
