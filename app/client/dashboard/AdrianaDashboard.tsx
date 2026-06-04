/**
 * AdrianaDashboard — /client/dashboard's mobile-app body.
 *
 * Mirrors Atlantic_Hub_Playbook/client_view_social_mock.html exactly:
 *   1. Sticky cream top bar — A&V logo + brand + "Client" pill + initials avatar
 *   2. Fraunces greeting with italic emerald accent + subhead count
 *   3. Brand switcher Stories row (active brand + other brands + add brand)
 *   4. Featured Signal hero — top distress entity with cascade trail + CTA
 *   5. "Your watchlist" SignalCard grid (2→1 col, brand chip + Fraunces one-liner + trail + primary CTA)
 *   6. "Fresh leads" SignalCard grid (same shape)
 *   7. Bottom tab bar — provided by app/client/layout.tsx (no-op here)
 *
 * All styling lives in the canonical design system at
 * `app/client/_styles/app.css` (loaded by app/client/layout.tsx for live;
 * imported directly by the operator preview route). NO hex literals here.
 * Dummy initials + emerald-tinted card logos keep the layout from reading
 * vacant when a brand has no logo/cover yet.
 */
'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

export interface BrandChip {
  id: number;
  name: string;
  initials: string;
  href: string;
  active: boolean;
}

export interface CascadeNode {
  label: string;
  payoff?: boolean;
}

export interface FeaturedSignal {
  eyebrow: string;            // e.g. "✦ This week's strongest signal"
  headline: string;           // headline; wrap accent in <em>...</em> using `headlineAccent`
  headlineAccent?: string;    // optional italic-gold portion appended
  who: string;                // "Meridian Holdings LLC · flagged on your CBB watchlist"
  trail: CascadeNode[];
  ctaLabel: string;           // "Open the signal →"
  ctaHref: string;
  /** Optional hero photo. Falls back to seeded picsum so the hero isn't vacant. */
  heroUrl?: string;
}

export interface CardChip {
  kind: 'distress' | 'fit';
  label: string;              // "New · filed yesterday" OR "94 fit · warm"
}

export interface SignalCard {
  id: string;
  entityName: string;
  entityInitial: string;      // single letter for the rounded logo
  /** Optional photo for the rounded logo square. Falls back to initial-on-emerald. */
  logoUrl?: string;
  chip: CardChip;
  oneLiner: string;           // Fraunces one-line headline
  trail: CascadeNode[];
  primaryAction: {
    label: string;            // "✎ Draft outreach" / "📞 Call now" / "✚ Add to pipeline"
    /** href OR onClick (via clientAction). href wins if both supplied. */
    href?: string;
  };
}

export interface AdrianaDashboardProps {
  brandName: string;          // header brand name (e.g. "Atlantic & Vine")
  brandPill: string;          // header pill (e.g. "Client")
  firstName: string;          // "Adriana"
  userInitial: string;        // "A"
  greetingTime: 'morning' | 'afternoon' | 'evening';
  subhead: string;            // "3 new signals on your watchlist since yesterday..."
  brands: BrandChip[];
  hero: FeaturedSignal | null;
  watchlist: {
    activeCountLabel: string; // "CBB · 12 active"
    moreHref: string;
    cards: SignalCard[];
  };
  freshLeads: {
    sublabel: string;         // "enriched today"
    moreHref: string;
    cards: SignalCard[];
  };
}

function timeWord(t: AdrianaDashboardProps['greetingTime']): string {
  return t === 'morning' ? 'Good morning' : t === 'afternoon' ? 'Good afternoon' : 'Good evening';
}

function Trail({ nodes, dark }: { nodes: CascadeNode[]; dark?: boolean }) {
  if (nodes.length === 0) return null;
  return (
    <div className="trail">
      {nodes.map((n, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
          <span className={`sig${n.payoff ? ' pay' : ''}`}>{n.label}</span>
          {i < nodes.length - 1 && <span className="arw" aria-hidden="true">→</span>}
        </span>
      ))}
    </div>
  );
}

function Card({ card }: { card: SignalCard }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function activate() {
    if (card.primaryAction.href) {
      startTransition(() => router.push(card.primaryAction.href!));
    }
  }

  return (
    <article className="app-card">
      <div className="hd">
        <div
          className="logo"
          style={card.logoUrl ? { backgroundImage: `url(${card.logoUrl})` } : undefined}
        >
          <span className="sc" />
          <b>{card.entityInitial}</b>
        </div>
        <div className="nm">
          <b title={card.entityName}>{card.entityName}</b>
          <span className={`chip${card.chip.kind === 'fit' ? ' fit' : ''}`}>{card.chip.label}</span>
        </div>
        <button type="button" className="more" aria-label="More actions">⋯</button>
      </div>
      <p className="ln">{card.oneLiner}</p>
      <Trail nodes={card.trail} />
      <div className="foot">
        <button
          type="button"
          className="pcta"
          onClick={activate}
          disabled={pending}
        >
          {pending ? 'Opening…' : card.primaryAction.label}
        </button>
        <button type="button" className="scnd" aria-label="More">⋯</button>
      </div>
    </article>
  );
}

export default function AdrianaDashboard(p: AdrianaDashboardProps) {
  // Outer .app wrapper lives in app/client/layout.tsx so every /client/*
  // page inherits the design system without re-wrapping.
  return (
    <>
      {/* Top bar */}
      <div className="app-top">
        <div className="app-top-in">
          <img src="https://atlanticandvine.netlify.app/av-logo.png" alt="A&amp;V" />
          <span className="bt">{p.brandName}</span>
          <span className="pill">{p.brandPill}</span>
          <div className="me">
            <span>{p.firstName}</span>
            <span className="av" aria-hidden="true">{p.userInitial}</span>
          </div>
        </div>
      </div>

      <div className="app-wrap">
        {/* Greeting */}
        <section className="app-hello">
          <h1>
            {timeWord(p.greetingTime)}, <em>{p.firstName}.</em>
          </h1>
          <p>{p.subhead}</p>
        </section>

        {/* Brand switcher Stories */}
        <div className="app-brands" aria-label="Switch brand">
          {p.brands.map((b) => (
            <Link
              key={b.id}
              href={b.href}
              className={`app-brand${b.active ? ' on' : ''}`}
              aria-current={b.active ? 'page' : undefined}
            >
              <div className="ring">
                <div className="pic">{b.initials}</div>
              </div>
              <span className="lbl">{b.name}</span>
            </Link>
          ))}
          <Link href="/client/intake" className="app-brand add">
            <div className="ring">
              <div className="pic">+</div>
            </div>
            <span className="lbl">Add brand</span>
          </Link>
        </div>

        {/* Featured Signal hero */}
        {p.hero && (
          <Link href={p.hero.ctaHref} className="app-feat" aria-label={p.hero.headline}>
            <div
              className="ph"
              style={p.hero.heroUrl ? { backgroundImage: `url(${p.hero.heroUrl})` } : undefined}
            />
            <div className="sc" />
            <div className="b">
              <span className="eb">{p.hero.eyebrow}</span>
              <h2>
                {p.hero.headline}
                {p.hero.headlineAccent && <> <em>{p.hero.headlineAccent}</em></>}
              </h2>
              <div className="who">{p.hero.who}</div>
              <Trail nodes={p.hero.trail} dark />
              <span className="cta">{p.hero.ctaLabel}</span>
            </div>
          </Link>
        )}

        {/* Watchlist */}
        <div className="app-sh">
          <h3>Your <em>watchlist</em></h3>
          {p.watchlist.activeCountLabel && <span className="ct">{p.watchlist.activeCountLabel}</span>}
          <Link href={p.watchlist.moreHref} className="more">View all →</Link>
        </div>
        {p.watchlist.cards.length === 0 ? (
          <div className="app-empty">
            <p>No entries yet. As your public-records sources fire, the strongest signals will land here.</p>
          </div>
        ) : (
          <div className="app-cards">
            {p.watchlist.cards.map((c) => <Card key={c.id} card={c} />)}
          </div>
        )}

        {/* Fresh leads */}
        <div className="app-sh">
          <h3>Fresh <em>leads</em></h3>
          {p.freshLeads.sublabel && <span className="ct">{p.freshLeads.sublabel}</span>}
          <Link href={p.freshLeads.moreHref} className="more">View all →</Link>
        </div>
        {p.freshLeads.cards.length === 0 ? (
          <div className="app-empty">
            <p>Your enrichment queue is quiet right now. New leads will surface here as they're scored.</p>
          </div>
        ) : (
          <div className="app-cards">
            {p.freshLeads.cards.map((c) => <Card key={c.id} card={c} />)}
          </div>
        )}
      </div>
    </>
  );
}
