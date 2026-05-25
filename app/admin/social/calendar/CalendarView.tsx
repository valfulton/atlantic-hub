import Link from 'next/link';
import { holidayMap } from '@/lib/calendar/holidays';
import { KIND_EMOJI, type ImportantDate } from '@/lib/calendar/important_dates';
import type { TimelineItem, TimelineItemStatus } from '@/lib/pr/types';
import { TimelineEntry } from './TimelineEntry';
import { AddImportantDate } from './AddImportantDate';

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
  skin: SkinKey;
  importantDates: ImportantDate[];
}

// ---- skins: selectable palettes for the grid ------------------------------
export type SkinKey = 'midnight' | 'regatta' | 'champagne' | 'mono';
export const SKIN_KEYS: SkinKey[] = ['midnight', 'regatta', 'champagne', 'mono'];
interface Skin {
  label: string; gridBg: string; cellIn: string; cellOut: string;
  today: string; holFg: string; holBg: string;
}
const SKINS: Record<SkinKey, Skin> = {
  midnight: { label: 'Midnight', gridBg: 'rgba(255,255,255,0.06)', cellIn: 'rgba(10,10,14,0.85)', cellOut: 'rgba(10,10,14,0.45)', today: 'rgba(255,156,91,0.6)', holFg: '#fcd34d', holBg: 'rgba(245,199,61,0.10)' },
  regatta: { label: 'Regatta', gridBg: 'rgba(45,212,191,0.12)', cellIn: 'rgba(7,15,20,0.9)', cellOut: 'rgba(7,15,20,0.5)', today: 'rgba(45,212,191,0.75)', holFg: '#7dd3fc', holBg: 'rgba(45,212,191,0.10)' },
  champagne: { label: 'Champagne', gridBg: 'rgba(255,199,61,0.14)', cellIn: 'rgba(20,16,8,0.9)', cellOut: 'rgba(20,16,8,0.55)', today: 'rgba(255,199,61,0.75)', holFg: '#fcd34d', holBg: 'rgba(245,199,61,0.16)' },
  mono: { label: 'Mono', gridBg: 'rgba(148,163,184,0.16)', cellIn: 'rgba(15,18,24,0.92)', cellOut: 'rgba(15,18,24,0.55)', today: 'rgba(203,213,225,0.7)', holFg: '#cbd5e1', holBg: 'rgba(148,163,184,0.10)' }
};

const STATUS_STYLE: Record<TimelineItemStatus, { label: string; bg: string; fg: string }> = {
  draft: { label: 'Draft', bg: 'rgba(148,163,184,0.18)', fg: '#cbd5e1' },
  scheduled: { label: 'Scheduled', bg: 'rgba(59,130,246,0.20)', fg: '#93c5fd' },
  publishing: { label: 'Publishing', bg: 'rgba(245,158,11,0.20)', fg: '#fcd34d' },
  published: { label: 'Published', bg: 'rgba(16,185,129,0.22)', fg: '#6ee7b7' },
  failed: { label: 'Failed', bg: 'rgba(239,68,68,0.20)', fg: '#fca5a5' },
  canceled: { label: 'Canceled', bg: 'rgba(148,163,184,0.12)', fg: '#94a3b8' }
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarView({ view, anchor, window, items, tenant, tenants, skin, importantDates }: Props) {
  const sk = SKINS[skin] ?? SKINS.midnight;
  const today = startOfDay(new Date());

  // Client important dates (birthdays, busy seasons…) bucketed by ISO day.
  const datesByDay = new Map<string, ImportantDate[]>();
  for (const d of importantDates) {
    const arr = datesByDay.get(d.iso) ?? [];
    arr.push(d);
    datesByDay.set(d.iso, arr);
  }
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

  // Fun holiday markers so the grid is never barren + seasonal hooks are obvious.
  const holidays = holidayMap(cells.map((c) => c.getFullYear()));

  const periodLabel =
    view === 'week'
      ? `Week of ${window.periodStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : window.periodStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div>
      {/* nav bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <NavLink href={hrefFor(view, navAnchor(view, anchor, -1), tenant, skin)} label="Previous period">&#8592;</NavLink>
          <NavLink href={hrefFor(view, toIso(today), tenant, skin)} label="Jump to today">Today</NavLink>
          <NavLink href={hrefFor(view, navAnchor(view, anchor, 1), tenant, skin)} label="Next period">&#8594;</NavLink>
          <span className="text-base font-semibold ml-2" style={{ color: '#fff' }}>{periodLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <ToggleLink href={hrefFor('week', toIso(anchor), tenant, skin)} active={view === 'week'}>Week</ToggleLink>
          <ToggleLink href={hrefFor('month', toIso(anchor), tenant, skin)} active={view === 'month'}>Month</ToggleLink>
        </div>
      </div>

      {/* tenant filter */}
      {tenants.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-muted">Brand:</span>
          <TenantChip href={hrefFor(view, toIso(anchor), null, skin)} active={!tenant}>All</TenantChip>
          {tenants.map((t) => (
            <TenantChip key={t} href={hrefFor(view, toIso(anchor), t, skin)} active={tenant === t}>{t}</TenantChip>
          ))}
        </div>
      )}

      {/* skin picker — give reps a look they like; choice persists in the URL */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-muted">Skin:</span>
        {SKIN_KEYS.map((s) => (
          <TenantChip key={s} href={hrefFor(view, toIso(anchor), tenant, s)} active={skin === s}>{SKINS[s].label}</TenantChip>
        ))}
      </div>

      {/* add a client important date (recurs yearly, layers onto the grid) */}
      <div className="mb-4">
        <AddImportantDate tenant={tenant} />
      </div>

      {/* weekday header */}
      <div className="grid grid-cols-7 gap-px mb-px">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-[11px] uppercase tracking-wide text-muted px-2 py-1 text-center">{w}</div>
        ))}
      </div>

      {/* grid */}
      <div
        className="grid grid-cols-7 gap-px rounded-lg overflow-hidden"
        style={{ background: sk.gridBg }}
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
                background: inPeriod ? sk.cellIn : sk.cellOut,
                minHeight: view === 'week' ? 220 : 104,
                outline: isToday ? `1px solid ${sk.today}` : 'none'
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
              {holidays.get(key) && (
                <div
                  className="text-[10px] mb-1 truncate rounded px-1 py-0.5"
                  title={holidays.get(key)!.name}
                  style={{ color: sk.holFg, background: sk.holBg }}
                >
                  {holidays.get(key)!.emoji} {holidays.get(key)!.name}
                </div>
              )}
              {datesByDay.get(key)?.map((d, i) => (
                <div
                  key={i}
                  className="text-[10px] mb-1 truncate rounded px-1 py-0.5"
                  title={d.label}
                  style={{ color: '#fda4af', background: 'rgba(244,63,94,0.12)' }}
                >
                  {KIND_EMOJI[d.kind] ?? '📌'} {d.label}
                </div>
              ))}
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
        <div
          className="mt-5 rounded-2xl p-5 sm:p-6"
          style={{
            background: 'radial-gradient(120% 140% at 0% 0%, rgba(245,158,11,0.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
            border: '1px solid rgba(255,255,255,0.10)'
          }}
        >
          <div className="text-[10px] uppercase tracking-[0.22em] mb-2" style={{ color: '#FFC73D' }}>Let&apos;s fill this calendar</div>
          <h3 className="text-lg font-semibold text-ink">Nothing scheduled yet — let&apos;s change that.</h3>
          <p className="text-sm text-muted mt-1.5 max-w-xl leading-relaxed">
            A great calendar starts with a clear story. Sharpen your <strong>narrative lines</strong>, then generate
            on-thesis social posts and watch them land here — staggered, branded, and ready to approve.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/admin/av/narrative" className="rounded-lg px-4 py-2 text-sm font-medium" style={{ background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)', color: '#1a1207' }}>
              Nurture your narrative lines →
            </Link>
            <Link href="/admin/av/content" className="rounded-lg px-4 py-2 text-sm" style={{ background: 'rgba(255,255,255,0.06)', color: '#e5e7eb', border: '1px solid rgba(255,255,255,0.14)' }}>
              Generate socials now
            </Link>
          </div>
        </div>
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

function hrefFor(view: 'week' | 'month', anchorIso: string, tenant: string | null, skin?: SkinKey): string {
  const p = new URLSearchParams();
  p.set('view', view);
  p.set('anchor', anchorIso);
  if (tenant) p.set('tenant', tenant);
  if (skin && skin !== 'midnight') p.set('skin', skin); // default skin stays out of the URL
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
