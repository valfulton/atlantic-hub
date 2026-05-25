import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { fetchTimelineItems, fetchTimelineTenants } from './timeline';
import { getPublishingPause } from '@/lib/social/publishing_control';
import { getImportantDatesForWindow } from '@/lib/calendar/important_dates';
import { CalendarView, SKIN_KEYS, type SkinKey } from './CalendarView';
import { CalendarSelectionProvider } from './CalendarSelection';
import { StopThePresses } from './StopThePresses';
import { SchedulePostComposer } from './SchedulePostComposer';
import { CelebrationSettings } from './CelebrationSettings';
import { CalendarDnD } from './CalendarDnD';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

interface ChannelRow extends RowDataPacket {
  id: number;
  provider: string;
  display_name: string | null;
  tenant_id: string;
}

async function fetchActiveChannels(): Promise<{ id: number; provider: string; displayName: string | null; tenantId: string }[]> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<ChannelRow[]>(
      `SELECT id, provider, display_name, tenant_id FROM social_connections WHERE status = 'active' ORDER BY tenant_id, provider`
    );
    return rows.map((r) => ({ id: r.id, provider: r.provider, displayName: r.display_name, tenantId: r.tenant_id }));
  } catch {
    return [];
  }
}

export const dynamic = 'force-dynamic';

/**
 * /admin/social/calendar -- the Campaign Timeline.
 *
 * NOT a passive content calendar: this is the campaign-orchestration spine.
 * v1 reads social_outbox through the normalized TimelineItem read layer
 * (./timeline.ts) so PR, outreach, commercials and launches can be unified onto
 * the SAME timeline later without a rewrite. Week + month views, color by
 * status, filter by tenant. Owner/staff only.
 *
 * Fully server-rendered; navigation is via query params (?view=, ?anchor=,
 * ?tenant=) so no client-side data fetching is needed.
 */
export default async function CampaignTimelinePage({
  searchParams
}: {
  searchParams: { view?: string; anchor?: string; tenant?: string; skin?: string };
}) {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') {
    redirect('/admin');
  }

  const view: 'week' | 'month' = searchParams.view === 'week' ? 'week' : 'month';
  const anchor = parseAnchor(searchParams.anchor);
  const tenant = searchParams.tenant && searchParams.tenant !== 'all' ? searchParams.tenant : null;
  const skin: SkinKey = (SKIN_KEYS as string[]).includes(searchParams.skin ?? '') ? (searchParams.skin as SkinKey) : 'midnight';

  const window = computeWindow(view, anchor);
  const [items, tenants, pause, importantDates, channels] = await Promise.all([
    fetchTimelineItems({ from: toIso(window.gridStart), to: toIso(window.gridEnd), tenant }),
    fetchTimelineTenants(),
    getPublishingPause(),
    getImportantDatesForWindow({ tenant, fromIso: toIso(window.gridStart), toIso: toIso(window.gridEnd) }),
    fetchActiveChannels()
  ]);

  return (
    <div className="max-w-6xl">
      <div
        className="mb-1 inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10.5px] uppercase tracking-[0.12em] font-medium"
        style={{ background: 'rgba(255,90,110,0.12)', color: '#FFE2DE', border: '1px solid rgba(255,90,110,0.3)' }}
      >
        <span>Orchestration</span>
      </div>
      <h1 className="text-3xl font-semibold tracking-tight mt-2 mb-1">
        Campaign{' '}
        <span
          className="font-bold italic"
          style={{
            background: 'linear-gradient(120deg, #FF5A6E 0%, #FF9C5B 50%, #FFC73D 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent'
          }}
        >
          timeline
        </span>
      </h1>
      <p className="text-sm text-muted mb-6 max-w-2xl">
        One operational timeline for everything that goes out. Today it shows your scheduled and
        published social posts; it is built to unify outreach, PR pitches, releases, commercials and
        seasonal campaigns onto the same view as those systems come online.
      </p>

      <StopThePresses initial={pause} />

      <CelebrationSettings />

      <SchedulePostComposer channels={channels} />

      <CalendarSelectionProvider>
        <CalendarDnD>
          <CalendarView
            view={view}
            anchor={anchor}
            window={window}
            items={items}
            tenant={tenant}
            tenants={tenants}
            skin={skin}
            importantDates={importantDates}
          />
        </CalendarDnD>
      </CalendarSelectionProvider>
    </div>
  );
}

// ---- date helpers (shared shape used by CalendarView) --------------------

export interface CalWindow {
  /** First day rendered in the grid (a Sunday for month view). */
  gridStart: Date;
  /** Exclusive end of the grid. */
  gridEnd: Date;
  /** The focal period start (first of month, or week start). */
  periodStart: Date;
  /** The focal period end (exclusive). */
  periodEnd: Date;
}

function parseAnchor(s: string | undefined): Date {
  if (s) {
    const d = new Date(s + 'T00:00:00');
    if (!Number.isNaN(d.getTime())) return startOfDay(d);
  }
  return startOfDay(new Date());
}

function computeWindow(view: 'week' | 'month', anchor: Date): CalWindow {
  if (view === 'week') {
    const periodStart = startOfWeek(anchor);
    const periodEnd = addDays(periodStart, 7);
    return { gridStart: periodStart, gridEnd: periodEnd, periodStart, periodEnd };
  }
  const periodStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const periodEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  const gridStart = startOfWeek(periodStart);
  const gridEnd = addDays(gridStart, 42); // 6 weeks
  return { gridStart, gridEnd, periodStart, periodEnd };
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  return addDays(s, -s.getDay()); // Sunday-based
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
