'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const HH_NAV = [
  { href: '/admin', label: 'Home', section: 'top' as const },
  { href: '/admin/events', label: 'System events', section: 'top' as const },
  { href: '/admin/social', label: 'Social integrations', section: 'top' as const },
  { href: '/admin/hh', label: 'HunterHoney', section: 'tenant' as const },
  { href: '/admin/hh/subscribers', label: 'Subscribers', section: 'sub' as const },
  { href: '/admin/hh/fap-applications', label: 'FAP Applications', section: 'sub' as const },
  { href: '/admin/hh/cohort-waitlist', label: 'Cohort Waitlist', section: 'sub' as const },
  { href: '/admin/hh/research-api', label: 'Research API', section: 'sub' as const }
];

const AV_NAV = [
  { href: '/admin/av', label: 'Atlantic & Vine', section: 'tenant' as const },
  { href: '/admin/av/clients', label: 'Clients', section: 'sub' as const },
  { href: '/admin/av/discover', label: 'Discover leads', section: 'sub' as const },
  { href: '/admin/av/import', label: 'Import CSV', section: 'sub' as const },
  { href: '/admin/av/outreach', label: 'Outreach', section: 'sub' as const },
  { href: '/admin/pr', label: 'PR engine', section: 'sub' as const },
  { href: '/admin/av/campaigns', label: 'Narrative lanes', section: 'sub' as const },
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
          {/* Honeycomb brand mark — ties to HunterHoney visual language */}
          <svg
            width="22"
            height="24"
            viewBox="0 0 22 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            className="shrink-0"
          >
            <path
              d="M11 1.5L20.5 7v10L11 22.5 1.5 17V7L11 1.5z"
              stroke="#f59e0b"
              strokeWidth="1.5"
              fill="rgba(245, 158, 11, 0.12)"
            />
            <circle cx="11" cy="12" r="2.5" fill="#f59e0b" />
          </svg>
          <div className="text-base font-semibold tracking-tight text-ink">Atlantic Hub</div>
        </div>
        <div className="flex items-center gap-2 mt-2 ml-9">
          <span className="live-dot" aria-hidden="true" />
          <span className="text-[10.5px] text-muted uppercase tracking-[0.12em] font-medium">
            Live · Operator
          </span>
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
