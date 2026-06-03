'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import BrandSeal from './BrandSeal';
import PresentationModeToggle from '@/app/_components/PresentationModeToggle';
import DailySpendChip from '@/app/_components/DailySpendChip';

const HH_NAV = [
  { href: '/admin', label: 'Home', section: 'top' as const },
  { href: '/admin/events', label: 'System events', section: 'top' as const },
  { href: '/admin/social', label: 'Social integrations', section: 'top' as const },
  { href: '/admin/social/calendar#stop-the-presses', label: '🛑 Stop the presses', section: 'top' as const },
  { href: '/admin/hh', label: 'HunterHoney', section: 'tenant' as const },
  { href: '/admin/hh/subscribers', label: 'Subscribers', section: 'sub' as const },
  { href: '/admin/hh/fap-applications', label: 'FAP Applications', section: 'sub' as const },
  { href: '/admin/hh/cohort-waitlist', label: 'Cohort Waitlist', section: 'sub' as const },
  { href: '/admin/hh/research-api', label: 'Research API', section: 'sub' as const }
];

const AV_NAV = [
  { href: '/admin/av', label: 'Atlantic & Vine', section: 'tenant' as const },
  // (#275) Side-by-side preview of the new readable lead view. The label
  // is val's own naming — she asked for the entry from the start. The
  // existing /admin/av cockpit stays unchanged; this entry lands on a
  // small index that lets her open any lead in the new view.
  { href: '/admin/av/lead', label: 'Leads (new view)', section: 'sub' as const },
  { href: '/admin/av/clients', label: 'Clients', section: 'sub' as const },
  { href: '/admin/av/employees', label: 'Employees', section: 'sub' as const },
  { href: '/admin/av/discover', label: 'Find new leads', section: 'sub' as const },
  { href: '/admin/av/import', label: 'Import CSV', section: 'sub' as const },
  { href: '/admin/av/outreach', label: 'Outreach', section: 'sub' as const },
  { href: '/admin/pr', label: 'PR engine', section: 'sub' as const },
  // (#56) Sidebar collapsed: 'Narrative lines' + the (404'ing) 'Campaigns'
  // entry both pointed at the same concept. One entry pointing at the
  // narrative cockpit, labeled the friendlier 'Campaigns' — internal docs
  // still call them narrative lines (the strategic noun); the sidebar
  // calls them what they USE: campaigns the customer is running.
  { href: '/admin/av/narrative', label: 'Campaigns', section: 'sub' as const },
  { href: '/admin/av/intake', label: 'Client intake', section: 'sub' as const },
  { href: '/admin/av/brief', label: 'Creative brief', section: 'sub' as const },
  { href: '/admin/av/prompts', label: 'AI prompts', section: 'sub' as const },
  { href: '/admin/av/content', label: 'Content & blog', section: 'sub' as const },
  { href: '/admin/av/commercials', label: 'Commercials', section: 'sub' as const },
  { href: '/admin/social/calendar', label: 'Campaign timeline', section: 'sub' as const }
];

const EBW_NAV = [
  { href: '/admin/ebw', label: 'Events by Water', section: 'tenant' as const },
  { href: '/admin/ebw/inquiries', label: 'Inquiries', section: 'sub' as const },
  { href: '/admin/ebw/bookings', label: 'Bookings', section: 'sub' as const },
  { href: '/admin/ebw/revenue', label: 'Revenue', section: 'sub' as const },
  { href: '/admin/ebw/partners', label: 'Vessel + captain partners', section: 'sub' as const },
  { href: '/admin/ebw/investors', label: 'Investors', section: 'sub' as const },
  { href: '/admin/ebw/activity', label: 'Marketing activity', section: 'sub' as const }
];

export function Sidebar({ showAv = false, showEbw = false }: { showAv?: boolean; showEbw?: boolean }) {
  const pathname = usePathname();
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }
  return (
    <aside className="w-64 min-h-screen flex flex-col bg-[rgba(10,15,26,0.55)] backdrop-blur-xl border-r border-border">
      {/* Brand header */}
      <div className="px-6 py-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          {/* Brand seal — the logo on its own red field (#186 phase 1).
              Self-contained — never depends on the page bg behind it. */}
          <BrandSeal size="md" />
          <div className="text-base font-semibold tracking-tight text-ink">Atlantic Hub</div>
        </div>
        <div className="flex items-center gap-2 mt-2 ml-[52px]">
          <span className="live-dot" aria-hidden="true" />
          <span className="text-[10.5px] text-muted uppercase tracking-[0.12em] font-medium">
            Live · Operator
          </span>
        </div>
        {/* (#361) Presentation mode — hides cost / model / tech labels for
            investor or client demos. Persists in a cookie; soft-reloads on
            toggle so server components pick up the new value. */}
        <div className="mt-3 ml-[52px]">
          <PresentationModeToggle />
        </div>
        {/* (#367) Tenant-wide LLM spend over the last 24h — auto-hides under
            Presentation Mode, auto-hides when spend is zero. The visible burn
            rate while building. */}
        <div className="mt-2 ml-[52px]">
          <DailySpendChip />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 text-sm">
        {[...HH_NAV, ...(showAv ? AV_NAV : []), ...(showEbw ? EBW_NAV : [])].map((n) => {
          const active = pathname === n.href;
          const isSub = n.section === 'sub';
          const isTenantHeader = n.section === 'tenant';
          return (
            <Link
              key={n.href}
              href={n.href}
              className={[
                'relative block rounded-md transition-colors',
                isSub ? 'pl-8 pr-3 py-1.5 text-[13px]' : 'px-3 py-2',
                active
                  ? 'bg-[var(--surface-2)] text-ink font-medium'
                  : 'text-muted hover:bg-[var(--surface)] hover:text-ink',
                isTenantHeader ? 'mt-2 font-medium text-ink' : ''
              ].join(' ')}
            >
              {active && (
                <span
                  className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-brand"
                  style={{ boxShadow: '0 0 12px var(--brand-glow)' }}
                  aria-hidden="true"
                />
              )}
              {n.label}
            </Link>
          );
        })}
      </nav>

      {/* Sign out */}
      <div className="p-3 border-t border-border">
        <button
          onClick={logout}
          className="w-full px-3 py-2 text-sm text-muted rounded-md border border-border hover:border-brand hover:text-ink hover:bg-[var(--surface)] transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
