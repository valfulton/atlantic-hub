'use client';
/**
 * InvestorsMenu  (#294)
 *
 * A curated dropdown for the operator hub header that lets val open the
 * "show-an-investor" tour in one click. Mike Bannister has signaled
 * investment interest and the NDVIP owner is inbound — both demos benefit
 * from val never having to fumble through nav to find the next wow
 * surface.
 *
 * What goes in here: ONLY the surfaces that hold up cold under outside
 * eyes. Not the raw selftest/SQL/admin pages — those are operator-only.
 * Each entry has a one-line "what investor sees here" subline so val (or
 * a rep) can talk over the click instead of explaining what they're
 * looking at.
 *
 * Visual rules: follows feedback_contrast_rule — no white on amber.
 * Trigger is bg-brand text-black (the rule); panel is dark surface with
 * amber accents; row hover is amber tint, never solid amber.
 *
 * Self-contained client component. No data fetching here — the panel is
 * a static curated list. Closes on outside-click + Escape + route nav.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface InvestorLink {
  href: string;
  label: string;
  /** One-line "what an investor sees here" — talk track, not feature copy. */
  hint: string;
  /** Optional emoji marker (kept restrained per luxury-nautical brief). */
  icon?: string;
  /** When true, opens in a new tab (public-facing surfaces). */
  external?: boolean;
}

interface InvestorSection {
  title: string;
  items: InvestorLink[];
}

const SECTIONS: InvestorSection[] = [
  {
    title: 'The platform',
    items: [
      {
        href: '/admin/av/intelligence?presentation=1',
        label: 'The intelligence chain',
        hint: 'Intelligence created → activated → revenue influenced. The 60-second story.',
        icon: '🔗'
      },
      {
        href: '/admin/av/clients',
        label: 'Live client roster',
        hint: 'Every active brand, tier, and pipeline pulse — one screen.',
        icon: '🏛'
      },
      {
        href: '/admin/av/narrative',
        label: 'Campaigns spine',
        hint: 'The story we’re running through every channel, per client.',
        icon: '🪡'
      },
      {
        href: '/admin/pr',
        label: 'PR opportunity desk',
        hint: 'Inbound press matched to clients in real time — no humans triaging.',
        icon: '📰'
      },
      {
        href: '/admin/av/intel-freshness',
        label: 'Intelligence freshness',
        hint: 'Per-lead AI signal staleness; one click refreshes hundreds.',
        icon: '⚡'
      }
    ]
  },
  {
    title: 'What the client sees',
    items: [
      {
        href: '/admin/av/clients',
        label: 'Pick a client → preview mirror',
        hint: 'Operator-side preview of the client’s own luxury dashboard. The product they pay for.',
        icon: '👁'
      },
      {
        href: '/newsroom',
        label: 'Public newsroom',
        hint: 'Where un-hosted client work goes live — our distribution shopfront.',
        icon: '🌊',
        external: true
      }
    ]
  },
  {
    title: 'Cross-brand',
    items: [
      {
        href: '/admin/ebw',
        label: 'Events by Water cockpit',
        hint: 'The same engine running a second brand end-to-end.',
        icon: '⛵'
      },
      {
        href: '/admin/ebw/investors',
        label: 'EBW investor view',
        hint: 'Bookings + revenue rollup — proof the platform powers real ops.',
        icon: '📈'
      }
    ]
  }
];

export function InvestorsMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape + route change (Next Link navigations).
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        // (#293/#294) Contrast rule: bg-brand always text-black, never white.
        className="text-xs font-medium px-3 py-1.5 rounded-md bg-brand text-black hover:opacity-90 inline-flex items-center gap-1.5"
        title="Curated investor tour — one-click access to the surfaces that hold up under outside eyes."
      >
        <span>🎩</span>
        <span>Investors</span>
        <span
          aria-hidden="true"
          className="text-[10px]"
          style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 120ms ease' }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-[340px] rounded-xl border border-border shadow-2xl z-50 overflow-hidden"
          style={{ backgroundColor: '#0e1420' }}
        >
          <div className="px-4 py-3 border-b border-border bg-gradient-to-b from-amber-400/[0.06] to-transparent">
            <div className="text-[10px] uppercase tracking-[0.18em] text-brand">Investor tour</div>
            <div className="text-sm text-ink mt-0.5 font-medium">Curated walkthrough</div>
            <p className="text-[11.5px] text-muted mt-1 leading-relaxed">
              The surfaces that look strongest cold. Each entry has the talk track inline so you can lead the demo, not chase the URL.
            </p>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {SECTIONS.map((section) => (
              <div key={section.title} className="px-2 py-2">
                <div className="px-2 pt-1 pb-1.5 text-[10px] uppercase tracking-[0.14em] text-muted">
                  {section.title}
                </div>
                <ul className="space-y-0.5">
                  {section.items.map((item) => (
                    <li key={item.href + item.label}>
                      <Link
                        href={item.href}
                        target={item.external ? '_blank' : undefined}
                        rel={item.external ? 'noopener noreferrer' : undefined}
                        onClick={() => setOpen(false)}
                        className="block px-2.5 py-2 rounded-md hover:bg-amber-400/[0.07] transition group"
                      >
                        <div className="flex items-start gap-2.5">
                          {item.icon && (
                            <span className="text-base leading-none mt-0.5 shrink-0" aria-hidden="true">
                              {item.icon}
                            </span>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] text-ink font-medium leading-snug group-hover:text-amber-200 transition">
                              {item.label}
                              {item.external && (
                                <span className="ml-1.5 text-[10px] text-muted">↗</span>
                              )}
                            </div>
                            <div className="text-[11px] text-muted leading-snug mt-0.5">
                              {item.hint}
                            </div>
                          </div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="px-4 py-2.5 border-t border-border text-[10.5px] text-muted/80 leading-relaxed">
            Each link opens the live system, not a slide. The strongest demo is the one
            running in production.
          </div>
        </div>
      )}
    </div>
  );
}
