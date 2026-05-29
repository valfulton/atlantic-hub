'use client';
import { useState } from 'react';
import BrandSeal from '@/components/BrandSeal';

interface PortalHeaderProps {
  displayName: string | null;
  email: string;
  tier: 'audit_only' | 'sprint' | 'momentum' | 'scale';
  active: 'dashboard' | 'audit' | 'leads' | 'details' | 'pr';
}

const TIER_LABEL: Record<PortalHeaderProps['tier'], string> = {
  audit_only: 'Audit',
  sprint: 'Sprint',
  momentum: 'Momentum',
  scale: 'Scale'
};

export default function PortalHeader({ displayName, email, tier, active }: PortalHeaderProps) {
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch('/api/client/logout', { method: 'POST' });
    } catch {
      // Even if the request fails, clear locally by reload.
    }
    window.location.href = '/client/login';
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/60">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Brand seal — the logo on its own red field (#186 phase 1).
              Self-contained: never depends on page bg behind it. */}
          <BrandSeal size="md" />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-ink">Atlantic &amp; Vine</div>
            {/* Mirrors the operator chrome's "Live · Operator" line (components/
                Sidebar.tsx) -- same live-dot + label CSS, but shows the client's
                name instead of the operator label. */}
            <div className="flex items-center gap-2 mt-0.5">
              <span className="live-dot" aria-hidden="true" />
              <span className="text-[10.5px] text-muted uppercase tracking-[0.12em] font-medium">
                {displayName || 'Client'}
              </span>
            </div>
          </div>
        </div>

        <nav aria-label="Primary" className="hidden sm:flex items-center gap-1">
          <a
            href="/client/dashboard"
            aria-current={active === 'dashboard' ? 'page' : undefined}
            className={`px-3 py-1.5 rounded-md text-sm ${
              active === 'dashboard'
                ? 'bg-surface-2 text-ink'
                : 'text-muted hover:text-ink hover:bg-surface-2'
            }`}
          >
            Dashboard
          </a>
          <a
            href="/client/leads"
            aria-current={active === 'leads' ? 'page' : undefined}
            className={`px-3 py-1.5 rounded-md text-sm ${
              active === 'leads'
                ? 'bg-surface-2 text-ink'
                : 'text-muted hover:text-ink hover:bg-surface-2'
            }`}
          >
            Your Leads
          </a>
          <a
            href="/client/audit"
            aria-current={active === 'audit' ? 'page' : undefined}
            className={`px-3 py-1.5 rounded-md text-sm ${
              active === 'audit'
                ? 'bg-surface-2 text-ink'
                : 'text-muted hover:text-ink hover:bg-surface-2'
            }`}
          >
            Your Audit
          </a>
          {/* PR is Momentum+ but we render the link for Sprint clients too,
              since the page shows the upgrade panel itself. We hide it for
              audit_only (they don't even have leads yet, no value in a
              dead-end link). */}
          {tier !== 'audit_only' && (
            <a
              href="/client/pr"
              aria-current={active === 'pr' ? 'page' : undefined}
              className={`px-3 py-1.5 rounded-md text-sm ${
                active === 'pr'
                  ? 'bg-surface-2 text-ink'
                  : 'text-muted hover:text-ink hover:bg-surface-2'
              }`}
            >
              Your Press
            </a>
          )}
          <a
            href="/client/intake"
            aria-current={active === 'details' ? 'page' : undefined}
            className={`px-3 py-1.5 rounded-md text-sm ${
              active === 'details'
                ? 'bg-surface-2 text-ink'
                : 'text-muted hover:text-ink hover:bg-surface-2'
            }`}
          >
            Your Details
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-surface text-xs text-ink">
            <span className="text-muted truncate max-w-[160px]" title={email}>
              {displayName || email}
            </span>
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted border-l border-border pl-2">
              {TIER_LABEL[tier]}
            </span>
          </div>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="text-xs text-muted hover:text-ink px-2 py-1 disabled:opacity-60"
          >
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      </div>
    </header>
  );
}
