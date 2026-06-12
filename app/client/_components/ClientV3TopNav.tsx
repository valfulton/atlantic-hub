'use client';

/**
 * ClientV3TopNav — the ONE shared V3 client top bar, used by EVERY /client/*
 * page so navigation is identical everywhere (val: "nav consistent across all
 * pages", 2026-06-03). Monogram + wordmark + desktop nav links + optional
 * brand-chip switcher. Desktop nav mirrors the mobile BottomTabBar item set
 * (Home · Leads · Watchlist · Press · You); on mobile the links hide and the
 * BottomTabBar takes over. Replaces every per-page inline `.v3-top`.
 */
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const NAV = [
  { href: '/client/dashboard', label: 'Home' },
  // (val 2026-06-12) Matters — the case-management surface. Without this
  // link, family + counsel collaborators (Rebecca, Adriana on Johnson) had
  // NO way to reach /client/cases — they could log in but never find the
  // case dashboard they were invited to. Critical for defense_pr +
  // family_legacy_care + estate_litigation engagement_kinds.
  { href: '/client/cases', label: 'Matters' },
  { href: '/client/leads', label: 'Leads' },
  { href: '/client/watchlist', label: 'Watchlist' },
  // (#433) Campaigns + Calendar — the narrative-line spine + the approval queue.
  // Mirror entries live in OperatorPreviewChrome TABS; per the nav-tab mirror
  // rule, edits to either array must land together.
  { href: '/client/campaigns', label: 'Campaigns' },
  { href: '/client/calendar', label: 'Calendar' },
  // (#419) Content Studio — generated posts ready to approve, true-to-platform preview.
  { href: '/client/content', label: 'Content' },
  { href: '/client/pr', label: 'Press' },
  // Newsroom — the public Wire surfacing published work. Same URL for client and
  // operator (public route), so the mirror discipline is satisfied by the URL itself.
  { href: '/newsroom', label: 'Newsroom' }
  // (val 2026-06-09) "You" / /client/intake hidden from client-facing nav.
  // Page stays in code for operator backend editing only; new client intake
  // system pending separate design pass. DO NOT re-add without val's say-so.
];

export default function ClientV3TopNav({
  brands,
  activeBrandId,
  preview
}: {
  brands?: { id: string; label: string }[];
  activeBrandId?: string;
  /** In the operator preview mirror, nav links are inert (operator can't enter /client/*). */
  preview?: boolean;
}) {
  const path = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function switchTo(id: string) {
    if (preview || id === activeBrandId || busy) return;
    setBusy(id);
    try {
      const r = await fetch('/api/client/active-brand', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: Number.parseInt(id, 10) })
      });
      if (r.ok) router.refresh();
    } catch {
      /* non-fatal */
    } finally {
      setBusy(null);
    }
  }

  return (
    <header className="v3-top">
      {/* monogram only — the full lockup is illegible at nav size; the
          wordmark beside it carries the name */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/av-monogram.png" alt="Atlantic & Vine" className="v3-top__logo" />
      <span className="v3-top__nm">Atlantic &amp; Vine</span>

      <nav className="v3-nav" aria-label="Client navigation">
        {NAV.map((n) => {
          const on = !!path?.startsWith(n.href);
          const cls = 'v3-nav__lnk' + (on ? ' on' : '');
          return preview ? (
            <span key={n.href} className={cls} aria-current={on ? 'page' : undefined}>
              {n.label}
            </span>
          ) : (
            <Link key={n.href} href={n.href} className={cls} aria-current={on ? 'page' : undefined}>
              {n.label}
            </Link>
          );
        })}
      </nav>

      {brands && brands.length > 1 && (
        <div className="v3-switch" role="group" aria-label="Switch brand">
          {brands.map((b) => {
            const sel = b.id === activeBrandId;
            return (
              <button
                key={b.id}
                type="button"
                className={'v3-chip' + (sel ? ' on' : '')}
                onClick={() => switchTo(b.id)}
                disabled={preview || busy !== null}
                aria-current={sel ? 'true' : undefined}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
}
