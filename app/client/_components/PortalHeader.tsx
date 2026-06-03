'use client';
import { useState, useEffect } from 'react';
import BrandSeal from '@/components/BrandSeal';

interface PortalHeaderProps {
  displayName: string | null;
  email: string;
  tier: 'audit_only' | 'sprint' | 'momentum' | 'scale';
  active: 'dashboard' | 'audit' | 'leads' | 'details' | 'pr' | 'review' | 'intelligence' | 'watchlist';
}

const TIER_LABEL: Record<PortalHeaderProps['tier'], string> = {
  audit_only: 'Audit',
  sprint: 'Sprint',
  momentum: 'Momentum',
  scale: 'Scale'
};

interface NavItem {
  href: string;
  label: string;
  key: PortalHeaderProps['active'];
  /** Hide for audit_only tier. */
  paidOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/client/dashboard', label: 'Dashboard', key: 'dashboard' },
  { href: '/client/leads', label: 'Your Leads', key: 'leads' },
  { href: '/client/watchlist', label: 'Watchlist', key: 'watchlist', paidOnly: true },
  { href: '/client/audit', label: 'Your Audit', key: 'audit' },
  { href: '/client/pr', label: 'Your Press', key: 'pr', paidOnly: true },
  { href: '/client/social/review', label: 'To Review', key: 'review', paidOnly: true },
  { href: '/client/intelligence', label: 'Your Impact', key: 'intelligence', paidOnly: true },
  { href: '/client/intake', label: 'Your Details', key: 'details' }
];

export default function PortalHeader({ displayName, email, tier, active }: PortalHeaderProps) {
  const [signingOut, setSigningOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile menu on Escape so phone users can dismiss without scrolling.
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch('/api/client/logout', { method: 'POST' });
    } catch {
      /* Even if the request fails, clear locally by reload. */
    }
    window.location.href = '/client/login';
  }

  const visibleNav = NAV_ITEMS.filter((n) => !n.paidOnly || tier !== 'audit_only');

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/60">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-3">
        {/* V3 polish (#392) — flex with proper rhythm. On mobile the seal
            + display-name line are one row; on desktop "Atlantic & Vine"
            appears stacked above the live-dot line. */}
        <div className="flex items-center gap-3 min-w-0">
          <BrandSeal size="md" />
          <div className="leading-tight min-w-0">
            <div className="text-sm font-semibold text-ink truncate hidden sm:block">
              Atlantic &amp; Vine
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="live-dot shrink-0" aria-hidden="true" />
              <span className="text-[10.5px] text-muted uppercase tracking-[0.12em] font-medium truncate">
                {displayName || 'Client'}
              </span>
            </div>
          </div>
        </div>

        {/* Desktop nav — unchanged behavior, hidden below sm. */}
        <nav aria-label="Primary" className="hidden sm:flex items-center gap-1 flex-wrap">
          {visibleNav.map((n) => (
            <a
              key={n.key}
              href={n.href}
              aria-current={active === n.key ? 'page' : undefined}
              className={`px-3 py-1.5 rounded-md text-sm ${
                active === n.key
                  ? 'bg-surface-2 text-ink'
                  : 'text-muted hover:text-ink hover:bg-surface-2'
              }`}
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Desktop: full name + tier pill. Mobile: tier-only chip. */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-surface text-xs text-ink">
            <span className="text-muted truncate max-w-[160px]" title={email}>
              {displayName || email}
            </span>
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted border-l border-border pl-2">
              {TIER_LABEL[tier]}
            </span>
          </div>
          <span
            className="md:hidden text-[10px] uppercase tracking-[0.14em] text-muted px-2 py-1 rounded-full border border-border bg-surface"
            title={`${displayName || email} · ${TIER_LABEL[tier]} plan`}
          >
            {TIER_LABEL[tier]}
          </span>

          {/* Desktop sign-out — text link. */}
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="hidden sm:inline-flex text-xs text-muted hover:text-ink px-2 py-1 disabled:opacity-60"
          >
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>

          {/* (#391) Mobile menu trigger — replaces the desktop nav on small screens. */}
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            className="sm:hidden inline-flex items-center justify-center w-9 h-9 rounded-md border border-border bg-surface hover:bg-surface-2 text-ink"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2 4 H14 M2 8 H14 M2 12 H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* (#391) Mobile drawer — full-width vertical menu, slides under header.
          Closes when any link is tapped (the page nav will reload anyway). */}
      {mobileOpen && (
        <div className="sm:hidden border-t border-border bg-surface/95 backdrop-blur">
          <nav aria-label="Mobile primary" className="flex flex-col py-2 px-3">
            {visibleNav.map((n) => (
              <a
                key={n.key}
                href={n.href}
                onClick={() => setMobileOpen(false)}
                aria-current={active === n.key ? 'page' : undefined}
                className={`px-3 py-2.5 rounded-md text-sm ${
                  active === n.key
                    ? 'bg-surface-2 text-ink font-medium'
                    : 'text-ink/80 hover:text-ink hover:bg-surface-2'
                }`}
              >
                {n.label}
              </a>
            ))}
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="mt-2 px-3 py-2.5 rounded-md text-sm text-left text-muted hover:text-ink hover:bg-surface-2 border-t border-border/60 disabled:opacity-60"
            >
              {signingOut ? 'Signing out...' : 'Sign out'}
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
