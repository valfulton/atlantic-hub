// app/client/_components/BottomTabBar.tsx  (mobile nav)
// Thumb-first bottom bar for /client/*. Desktop: hidden (CSS hides at >=761px).
// 9 nav destinations don't fit a phone bar, so we show 5 primary tabs + a "More"
// sheet for the rest. All colors are tokens (cream/emerald), and the bar +
// sheet respect env(safe-area-inset-bottom) so nothing hides under the home
// indicator. Item set mirrors ClientV3TopNav (desktop) + OperatorPreviewChrome.
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

type Item = { href: string; label: string; icon: string };

// Primary thumb tabs — the everyday surfaces.
const PRIMARY: Item[] = [
  { href: '/client/dashboard', label: 'Home',      icon: 'M3 11l9-8 9 8 M5 10v10h14V10' },
  { href: '/client/leads',     label: 'Leads',     icon: 'M4 6h16 M4 12h16 M4 18h10' },
  { href: '/client/watchlist', label: 'Watchlist', icon: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0' },
  { href: '/client/content',   label: 'Content',   icon: 'M5 4h11l3 3v13H5z M14 4v4h4 M8 12h8 M8 16h6' }
];

// Overflow — opened from the "More" tab as a bottom sheet.
const MORE: Item[] = [
  { href: '/client/campaigns', label: 'Campaigns', icon: 'M4 9l16-5v15l-16-5z M4 9v6 M9 10v4' },
  { href: '/client/calendar',  label: 'Calendar',  icon: 'M5 4h14v16H5z M5 10h14 M9 4v4 M15 4v4' },
  { href: '/client/pr',        label: 'Press',     icon: 'M4 4h16v12H7l-3 3V4z' },
  { href: '/client/notes',     label: 'Notes',     icon: 'M4 4h16v12H7l-3 3V4z M8 8h8 M8 12h5' },
  { href: '/newsroom',         label: 'Newsroom',  icon: 'M4 5h16v14H4z M4 9h16 M8 5v14' },
  { href: '/client/intake',    label: 'You',       icon: 'M8 8a4 4 0 1 0 8 0 4 4 0 0 0-8 0 M4 21c0-4 4-6 8-6s8 2 8 6' }
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {d.split(' M').map((seg, i) => <path key={i} d={(i ? 'M' : '') + seg} />)}
    </svg>
  );
}

export default function BottomTabBar() {
  const path = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const onPath = (href: string) => !!path?.startsWith(href);
  const moreActive = MORE.some((m) => onPath(m.href));

  return (
    <>
      {moreOpen && (
        <>
          <button className="av-sheet-backdrop" aria-label="Close menu" onClick={() => setMoreOpen(false)} />
          <nav className="av-sheet" aria-label="More client navigation">
            <div className="av-sheet__grip" aria-hidden="true" />
            {MORE.map((m) => (
              <Link
                key={m.href}
                href={m.href}
                className={`av-sheet__row ${onPath(m.href) ? 'on' : ''}`}
                aria-current={onPath(m.href) ? 'page' : undefined}
                onClick={() => setMoreOpen(false)}
              >
                <Icon d={m.icon} />
                <span>{m.label}</span>
              </Link>
            ))}
          </nav>
        </>
      )}

      <nav className="av-tabs" aria-label="Client navigation">
        {PRIMARY.map((t) => (
          <Link key={t.href} href={t.href} className={`av-tab ${onPath(t.href) ? 'on' : ''}`} aria-current={onPath(t.href) ? 'page' : undefined}>
            <Icon d={t.icon} />
            <span>{t.label}</span>
          </Link>
        ))}
        <button
          type="button"
          className={`av-tab ${moreActive || moreOpen ? 'on' : ''}`}
          aria-haspopup="true"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
        >
          <Icon d="M4 6h16 M4 12h16 M4 18h16" />
          <span>More</span>
        </button>
      </nav>
    </>
  );
}
