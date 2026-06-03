/**
 * ClientDashboardV3  (#396, val 2026-06-03)
 *
 * The V3 client dashboard. Built FROM the demo_client_portal_v3.html spec
 * — not a retrofit of the old ClientDashboardBody. Replaces it entirely
 * for the new register:
 *
 *   - Monogram + brand-name top bar (Cormorant 21px) + brand chips
 *   - Cormorant greeting with italic amber emphasis
 *   - ONE hero card — top distress watchlist entity, cascade-attributed
 *   - "In motion" section: 3 quiet cards (campaigns queued, wire feature,
 *     this week learned)
 *   - QUIET · LEGIBLE · VERIFIABLE footer
 *
 * All styling via class names scoped under [data-skin="social"] in the
 * V3 CSS. No Tailwind. Cormorant + Inter. Navy + cream + amber.
 */
'use client';

import { useRouter } from 'next/navigation';
import type { SignalTrailNode } from '@/app/client/_components/SignalCard';

export interface DashboardCardData {
  title: string;
  body: string;
  linkLabel: string;
  linkHref: string;
  when: string;
}

export interface ClientDashboardV3Props {
  firstName: string;
  weekLabel: string;  // e.g. "Your channel · week of 2 June"
  brands: { id: string; label: string }[];
  activeBrandId: string;
  hero: {
    label: string;       // "This week's strongest signal"
    title: string;       // Voice-dressed headline
    body: string;        // 1–2 line description
    ctaLabel: string;    // "Open the signal"
    ctaHref: string;
    trail?: SignalTrailNode[];
  } | null;
  motion: DashboardCardData[];   // 0–4 cards
}

export default function ClientDashboardV3(p: ClientDashboardV3Props) {
  const router = useRouter();

  async function switchBrand(id: string) {
    if (id === p.activeBrandId) return;
    try {
      const r = await fetch('/api/client/active-brand', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: Number.parseInt(id, 10) })
      });
      if (r.ok) router.refresh();
    } catch { /* non-fatal */ }
  }

  return (
    <main className="v3-wrap">
      {/* Top bar — monogram + brand + chip switcher */}
      <header className="v3-top">
        <img src="/brand/av_logo_white1152.png" alt="Atlantic & Vine" className="v3-top__logo" />
        <span className="v3-top__nm">Atlantic &amp; Vine</span>
        {p.brands.length > 1 && (
          <nav className="v3-switch" aria-label="Switch brand">
            {p.brands.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`v3-chip ${b.id === p.activeBrandId ? 'on' : ''}`}
                onClick={() => switchBrand(b.id)}
              >
                {b.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      {/* Greeting */}
      <section className="v3-greet">
        <p className="v3-eyebrow">{p.weekLabel}</p>
        <h1 className="v3-h1">
          Good morning, <em>{p.firstName}.</em>
        </h1>
        <p className="v3-lede">
          {p.hero
            ? "Here's what's worth your attention."
            : 'Your channel is being set in motion. The first signals will appear here as the engine finds them.'}
        </p>
      </section>

      {/* Hero — single strongest signal */}
      {p.hero && (
        <article className="v3-hero">
          <div className="v3-hero__b">
            <div className="v3-hero__lab">{p.hero.label}</div>
            <h2 className="v3-hero__h">{p.hero.title}</h2>
            <p className="v3-hero__p">{p.hero.body}</p>
            {p.hero.trail && p.hero.trail.length > 0 && (
              <div className="sig-trail" style={{ marginBottom: '18px' }}>
                {p.hero.trail.map((n, i) => (
                  <span key={i} style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center' }}>
                    <span className={`sig ${n.payoff ? 'sig--payoff' : ''}`}>{n.label}</span>
                    {i < (p.hero?.trail?.length ?? 0) - 1 && <span className="sig-arw">→</span>}
                  </span>
                ))}
              </div>
            )}
            <a className="v3-cta" href={p.hero.ctaHref}>
              {p.hero.ctaLabel}
            </a>
          </div>
        </article>
      )}

      {/* "In motion" — quiet cards */}
      {p.motion.length > 0 && (
        <>
          <div className="v3-sec">In motion</div>
          {p.motion.map((c, i) => (
            <article key={i} className="v3-card">
              <h3 className="v3-card__h">{c.title}</h3>
              <p className="v3-card__p">{c.body}</p>
              <div className="v3-card__row">
                <a className="v3-link" href={c.linkHref}>{c.linkLabel}</a>
                <span className="v3-card__when">{c.when}</span>
              </div>
            </article>
          ))}
        </>
      )}

      <p className="v3-foot">QUIET · LEGIBLE · VERIFIABLE</p>
    </main>
  );
}
