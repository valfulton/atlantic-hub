// app/client/_components/BottomTabBar.tsx  (V3 social skin)
// Mobile nav for /client/* — replaces the hamburger. Thumb-friendly, persistent.
// Desktop: hidden (CSS hides it at >=761px). Render once in app/client/layout.tsx.
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/client/dashboard', label: 'Dashboard', icon: 'M3 11l9-8 9 8 M5 10v10h14V10' },
  { href: '/client/leads',     label: 'Leads',     icon: 'M4 6h16 M4 12h16 M4 18h10' },
  { href: '/client/watchlist', label: 'Watchlist', icon: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0' },
  { href: '/client/pr',        label: 'Press',     icon: 'M4 4h16v12H7l-3 3V4z' },
  { href: '/client/intake',    label: 'You',       icon: 'M8 8a4 4 0 1 0 8 0 4 4 0 0 0-8 0 M4 21c0-4 4-6 8-6s8 2 8 6' }
];

export default function BottomTabBar() {
  const path = usePathname();
  return (
    <nav className="av-tabs" aria-label="Client navigation">
      {TABS.map((t) => {
        const on = !!path?.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`av-tab ${on ? 'on' : ''}`} aria-current={on ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8">
              {t.icon.split(' M').map((d, i) => <path key={i} d={(i ? 'M' : '') + d} />)}
            </svg>
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
