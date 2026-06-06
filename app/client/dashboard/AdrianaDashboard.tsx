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
import { accent } from '@/lib/copy/accent';
import ClientHero from '@/app/client/_components/ClientHero';

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
  /** Contact facts from the lead/intake record. Phone + address are
   *  client-critical and must show when present (val 2026-06-05). Optional:
   *  watchlist/distress cards leave it undefined. */
  contact?: {
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    address?: string | null;
  };
}

/** AV employee currently on this client's account (#377 — Adriana rep demo).
 *  Shape mirrors `lib/client/employees_on_account.ts`. */
export interface TeamMember {
  userId: number;
  displayName: string;
  title: string | null;
  role: 'primary_rep' | 'rep' | 'support' | 'implicit';
  leadsAssigned: number;
  callsLast7Days: number;
  lastActivityAt: string | null;
}

export interface AdrianaDashboardProps {
  brandName: string;          // header brand name (e.g. "Atlantic & Vine")
  brandPill: string;          // header pill (e.g. "Client")
  firstName: string;          // "Adriana"
  userInitial: string;        // "A"
  greetingTime: 'morning' | 'afternoon' | 'evening';
  subhead: string;            // "3 new signals on your watchlist since yesterday..."
  copy?: Record<string, string>; // editable section copy (dashboard.sec.*, dashboard.empty)
  brands: BrandChip[];
  /** AV employees on this account — render as "Your A&V team" widget when present. */
  team: TeamMember[];
  /** (val 2026-06-06, SPEC) Outcome-hero payload — value first, jargon never.
   *  Pipeline = leads in play bucketed by band. potentialUsd = leadsInPlay ×
   *  avgDealValue (whole USD, null when no deal model on file). thisWeek =
   *  trailing 7d retention-hook counts; the hero hides any clause whose count
   *  is 0 (don't write "and 0 posts"). */
  pipeline: { total: number; hot: number; warm: number; cool: number };
  potentialUsd: number | null;
  thisWeek: {
    leadsAdded: number;
    postsAwaitingApproval: number;
    pressMatches: number;
    callsLogged: number;
  };
  /** (val 2026-06-06) Unpromoted watchlist count — drives the "ready to fill"
   *  hero state when pipeline is empty but engine is firing. */
  signalsWaiting?: { count: number };
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

/** Contact facts block — phone (tap-to-call) + address + website. Shows only
 *  what's present; renders nothing when the card carries no contact (watchlist). */
function CardMeta({ contact }: { contact?: SignalCard['contact'] }) {
  if (!contact) return null;
  const { phone, email, website, address } = contact;
  if (!phone && !email && !website && !address) return null;
  const tel = phone ? phone.replace(/[^\d+]/g, '') : '';
  return (
    <div className="meta">
      {phone && (
        <div className="row"><span className="k">Phone</span><a className="v" href={`tel:${tel}`}>{phone}</a></div>
      )}
      {address && (
        <div className="row"><span className="k">Address</span><span className="v">{address}</span></div>
      )}
      {email && (
        <div className="row"><span className="k">Email</span><a className="v" href={`mailto:${email}`}>{email}</a></div>
      )}
      {website && (
        <div className="row"><span className="k">Web</span><a className="v" href={website} target="_blank" rel="noopener">{website.replace(/^https?:\/\//, '')}</a></div>
      )}
    </div>
  );
}

/** Real tap-to-call href from a card's contact, or null. */
function telFromContact(c?: SignalCard['contact']): string | null {
  const phone = c?.phone;
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, '');
  return cleaned.replace(/\D/g, '').length >= 7 ? `tel:${cleaned}` : null;
}
/** Prefilled mailto from a card — a ready first email in one tap. */
function mailtoFromCard(card: SignalCard): string | null {
  const email = card.contact?.email;
  if (!email) return null;
  const subject = `Quick idea for ${card.entityName || 'your team'}`;
  const pain = (card.oneLiner || '').trim();
  const body = [
    'Hi there,',
    '',
    `I came across ${card.entityName || 'your business'} and wanted to reach out.`,
    ...(pain ? ['', pain] : []),
    '',
    'Would you be open to a short call this week?',
    '',
    'Best,'
  ].join('\n');
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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
      </div>
      <p className="ln">{card.oneLiner}</p>
      <Trail nodes={card.trail} />
      <CardMeta contact={card.contact} />
      <div className="foot">
        {telFromContact(card.contact) ? (
          <a className="pcta" href={telFromContact(card.contact)!}>📞 Call</a>
        ) : mailtoFromCard(card) ? (
          <a className="pcta" href={mailtoFromCard(card)!}>✉ Email</a>
        ) : (
          <button type="button" className="pcta" onClick={activate} disabled={pending}>
            {pending ? 'Opening…' : card.primaryAction.label}
          </button>
        )}
        {card.primaryAction.href && (
          <button type="button" className="scnd" onClick={activate} aria-label="Open lead">→</button>
        )}
      </div>
    </article>
  );
}

/** Two-letter initials for the team avatar tile. Matches initialsOf() pattern
 *  used elsewhere in the dashboard. */
function teamInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "3h ago" / "2d ago" / "just now" — kept tight, no relative-time library. */
function relTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/** "Your A&V team" widget — one .app-card per assigned employee. Renders nothing
 *  when no team members are on the account, so it never shows on Tim's view
 *  (no AV rep) but does on Adriana's (Rebecca assigned). */
function TeamRow({ team }: { team: TeamMember[] }) {
  if (!team || team.length === 0) return null;
  return (
    <>
      <div className="app-sh">
        <h3>Your A&amp;V <em>team</em></h3>
        <span className="ct">{team.length === 1 ? 'on it' : `${team.length} on it`}</span>
      </div>
      <div className="app-cards">
        {team.map((m) => {
          const lastSeen = relTime(m.lastActivityAt);
          return (
            <article key={m.userId} className="app-card">
              <div className="hd">
                <div className="logo">
                  <span className="sc" />
                  <b>{teamInitials(m.displayName)}</b>
                </div>
                <div className="nm">
                  <b title={m.displayName}>{m.displayName}</b>
                  <span className="chip fit">{m.title ?? 'A&V rep'}</span>
                </div>
              </div>
              <div className="meta">
                <div className="row"><span className="k">Leads</span><span className="v">{m.leadsAssigned}</span></div>
                <div className="row"><span className="k">Calls 7d</span><span className="v">{m.callsLast7Days}</span></div>
                {lastSeen && (
                  <div className="row"><span className="k">Last</span><span className="v">{lastSeen}</span></div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
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

        {/* (val 2026-06-06, SPEC_Dashboard_Outcome_Hero) Outcome hero — value
            first, then the hot signal. Reads "Your pipeline · N leads in play
            · ~$X potential" in emerald (never engine vocabulary), with the
            this-week recap as the retention hook. Empty state when nothing
            has landed yet ("Your pipeline is taking shape"). */}
        <ClientHero pipeline={p.pipeline} potentialUsd={p.potentialUsd} thisWeek={p.thisWeek} signalsWaiting={p.signalsWaiting} />

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
          <h3>{accent(p.copy?.['dashboard.sec.watchlist'] ?? 'Your *watchlist*')}</h3>
          {p.watchlist.activeCountLabel && <span className="ct">{p.watchlist.activeCountLabel}</span>}
          <Link href={p.watchlist.moreHref} className="more">View all →</Link>
        </div>
        {p.watchlist.cards.length === 0 ? (
          <div className="app-wire">
            <span className="eb">— Quiet on the wire —</span>
            <p>{p.copy?.['dashboard.empty'] ?? 'No entries yet. As your public-records sources fire, the strongest signals will land here.'}</p>
          </div>
        ) : (
          <div className="app-cards">
            {p.watchlist.cards.map((c) => <Card key={c.id} card={c} />)}
          </div>
        )}

        {/* Fresh leads */}
        <div className="app-sh">
          <h3>{accent(p.copy?.['dashboard.sec.leads'] ?? 'Fresh *leads*')}</h3>
          {p.freshLeads.sublabel && <span className="ct">{p.freshLeads.sublabel}</span>}
          <Link href={p.freshLeads.moreHref} className="more">View all →</Link>
        </div>
        {p.freshLeads.cards.length === 0 ? (
          <div className="app-wire">
            <span className="eb">— On the hunt —</span>
            <p>Your enrichment queue is quiet right now. New leads will surface here as they're scored.</p>
          </div>
        ) : (
          <div className="app-cards">
            {p.freshLeads.cards.map((c) => <Card key={c.id} card={c} />)}
          </div>
        )}

        {/* (#377, val 2026-06-05) Account team — moved to the footer position;
            employee assignment is supporting cast, never the headline.
            Awaiting UX/UI design pass — likely becomes a small chip strip
            rather than a card row. Renders nothing if no team assigned. */}
        <TeamRow team={p.team} />
      </div>
    </>
  );
}
