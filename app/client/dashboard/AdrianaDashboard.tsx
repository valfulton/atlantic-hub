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
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { accent } from '@/lib/copy/accent';
import ClientHero from '@/app/client/_components/ClientHero';
import type { EngagementKind, EngagementKindConfig } from '@/lib/client/engagement_kind';
import { KindHero, KindPanels } from './KindPanels';
import type { PressTouch } from '@/lib/client/press_touches';
import type { DistrictSignal } from '@/lib/client/district_heatmap';
import type { ItineraryStop } from '@/lib/client/itinerary';
import type { ClientCockpitDraft } from '@/lib/client/cockpit_drafts';

/** (#557) Live data for the kind-specific dashboard panels. Every field is
 *  optional — only panels enabled by the active engagement_kind get populated;
 *  lead_gen brands ship every field undefined. KindPanels falls back to its
 *  on-brand stub when a field is undefined, so the dashboard never errors. */
export interface KindData {
  pressTouches?: PressTouch[];
  pressWeekCount?: number;
  caseBrief?: {
    messageSupport: string | null;
    audienceInsights: string | null;
    timeline: string | null;
  };
  districtSignals?: DistrictSignal[];
  hasDistrictConfig?: boolean;
  itineraryStops?: ItineraryStop[];
  /** (#578) Drafts the operator has written/generated for this client.
   *  Visible inline (each card expands to show body). The CLIENT comment thread
   *  per draft lands in /client/notes via a deep-link. Lead_gen kinds skip. */
  cockpitDrafts?: ClientCockpitDraft[];
  cockpitDraftsPending?: number;
}

export interface BrandChip {
  id: number;
  name: string;
  initials: string;
  href: string;
  active: boolean;
}

/** (val 2026-06-14, UX/UI Beauty Pack) A case the logged-in user collaborates on
 *  (attorney, family caregiver, successor trustee, etc.). Surfaces as the
 *  white .av-matters card with the garnet count badge. The count is what fed
 *  the Matters tab badge too — single source of truth via the loader. */
export interface MatterCard {
  caseId: number;
  caseName: string;
  caseKind: string;
  roleLabel: string;
  openActions: number;
  urgentActions: number;
  href: string;
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
  /** (val 2026-06-14) Cases the logged-in user collaborates on (Adriana sees
   *  Johnson via family_case_collaborators). Empty array for users with no
   *  collaborator rows — the matters card hides entirely in that case. */
  matters: MatterCard[];
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
  /** (#551) Active engagement kind + its resolved config, from the loader
   *  (brand_members.engagement_kind). lead_gen keeps every existing surface
   *  untouched; other kinds swap in a kind hero, hide leads/watchlist per the
   *  config flags, and mount kind-specific stub panels. */
  engagementKind: EngagementKind;
  kindConfig: EngagementKindConfig;
  /** (#557) Live data for kind-specific panels. Optional fields per panel —
   *  KindPanels mounts the real panel when data is present, the stub when
   *  it's not. Lead_gen never uses this. */
  kindData?: KindData;
}

function timeWord(t: AdrianaDashboardProps['greetingTime']): string {
  return t === 'morning' ? 'Good morning' : t === 'afternoon' ? 'Good afternoon' : 'Good evening';
}

/** Human-readable case_kind label — mirrors the switch used on the cases pages.
 *  Falls through to 'Matter' for unknown kinds so a new vertical pack doesn't
 *  surface a raw enum string. */
function caseKindLabel(k: string): string {
  switch (k) {
    case 'trust_dispute': return 'Trust matter';
    case 'elder_advocacy': return 'Elder advocacy';
    case 'estate_litigation': return 'Estate matter';
    case 'malpractice_defense': return 'Malpractice defense';
    case 'campaign_legal': return 'Campaign legal';
    case 'guardianship': return 'Guardianship';
    case 'family_law': return 'Family matter';
    case 'business_litigation': return 'Business matter';
    case 'general_litigation':
    default:
      return 'Matter';
  }
}

/** Render the brand wordmark with the ampersand in italic Fraunces (the scrolly &). */
function wordmark(name: string) {
  const i = name.indexOf('&');
  if (i === -1) return name;
  return (
    <>
      {name.slice(0, i)}
      <span className="amp">&amp;</span>
      {name.slice(i + 1)}
    </>
  );
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
          {card.primaryAction.href ? (
            <a href={card.primaryAction.href} title={card.entityName} className="nm-link"><b>{card.entityName}</b></a>
          ) : (
            <b title={card.entityName}>{card.entityName}</b>
          )}
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
          <a className="pcta" href={mailtoFromCard(card)!}>✉️ Email</a>
        ) : (
          <button type="button" className="pcta" onClick={activate} disabled={pending}>
            {pending ? 'Opening…' : card.primaryAction.label}
          </button>
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

/** (val 2026-06-06) Client-only wrapper around relTime so SSR returns empty
 *  (no Date.now() in server-rendered HTML) and the value fills in after
 *  hydration. Fixes React #425/418/423 hydration cascade that was firing
 *  because server "5m ago" diverged from client "5m ago" by ~1 minute. */
function ClientTime({ iso }: { iso: string | null }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return <>{relTime(iso)}</>;
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
                {m.lastActivityAt && (
                  <div className="row"><span className="k">Last</span><span className="v"><ClientTime iso={m.lastActivityAt} /></span></div>
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
  // (val 2026-06-14) Surface the ACTIVE BRAND name so a multi-brand owner
  // (Adriana: CBB vs CLDA) can tell which brand's hub they're in at a glance —
  // the two views read near-identical otherwise.
  const activeBrandName = p.brands.find((b) => b.active)?.name ?? null;
  // (val 2026-06-14, UX/UI Beauty Pack) Matters card collapse state — when a
  // viewer has multiple matters or just wants to focus, they can minimize the
  // card. Default expanded so the count badge is visible on first paint.
  const [mattersMin, setMattersMin] = useState(false);
  return (
    <>
      {/* Top bar */}
      <div className="app-top">
        <div className="app-top-in">
          <img src="https://atlanticandvine.netlify.app/av-logo.png" alt="A&amp;V" />
          <span className="bt">{wordmark(p.brandName)}</span>
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
          {activeBrandName && (
            <p style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--emerald-deep)', margin: '0 0 6px' }}>
              {activeBrandName}
            </p>
          )}
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

        {/* (#551) Engagement-kind hero — only for non-lead_gen kinds. lead_gen
            keeps the greeting-as-summary + Featured Signal below, unchanged. */}
        {p.engagementKind !== 'lead_gen' && <KindHero config={p.kindConfig} />}

        {/* (#551 + #557) Kind-specific panels (Press touches / Case brief /
            District heat map / Itinerary). Each is gated inside by a config
            flag, so lead_gen mounts none of them and renders nothing here.
            Real panels render when kindData carries their payload; otherwise
            the on-brand stub still shows so the surface is never blank. */}
        <KindPanels config={p.kindConfig} kind={p.engagementKind} data={p.kindData} />

        {/* (val 2026-06-06) The ClientHero white pipeline card was duplicating
            the greeting subhead ("Your pipeline is steady. Keep working the
            ones in play below.") and stacking above the green Featured Signal
            hero. Killed. The greeting IS the pipeline summary. ONE hero on
            this page — the Featured Signal — and only when there's a real
            signal to feature. */}

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

        {/* (val 2026-06-14, UX/UI Beauty Pack) Your matters — white card with
            emerald left-accent and the garnet count badge. Surfaces every case
            the user collaborates on (Adriana sees Johnson). Card hides entirely
            when matters is empty (lead_gen-only clients with no collaborator
            rows). Single-source count via openActionItemCountForUserCase. */}
        {p.matters.length > 0 && (
          <section
            className={`av-matters${mattersMin ? ' is-min' : ''}`}
            aria-label="Your matters"
          >
            <button
              type="button"
              className="av-matters__min"
              onClick={() => setMattersMin((v) => !v)}
              aria-label={mattersMin ? 'Expand matters' : 'Minimize matters'}
            >
              {mattersMin ? '+' : '−'}
            </button>
            <p className="av-matters__eyebrow">
              Your matters
              {activeBrandName ? ` · ${p.brands.find((b) => b.active)?.initials ?? ''}` : ''}
            </p>
            <div className="av-matters__bodywrap">
              {p.matters.map((m) => (
                <div className="av-matters__row" key={m.caseId}>
                  <span
                    className="av-matters__count"
                    aria-label={`${m.openActions} open ${m.openActions === 1 ? 'item' : 'items'}`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
                      <path d="M9 11l3 3 8-8" />
                      <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
                    </svg>
                    {m.openActions > 0 && (
                      <span className="av-matters__n">{m.openActions}</span>
                    )}
                  </span>
                  <div className="av-matters__body">
                    <div className="av-matters__name">{m.caseName}</div>
                    <div className="av-matters__role">
                      {caseKindLabel(m.caseKind)} · Role: {m.roleLabel}
                    </div>
                    {m.openActions > 0 && (
                      <div className="av-matters__next">
                        {m.openActions} next step{m.openActions === 1 ? '' : 's'}
                        {m.urgentActions > 0 ? ` · ${m.urgentActions} urgent` : ''}
                      </div>
                    )}
                  </div>
                  <a href={m.href} className="av-matters__open">
                    Open the matter →
                  </a>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* (#551) Watchlist — gated by kind (lead_gen + political_campaign show
            it as district pulse; defense_pr / hospitality / book_pr hide it). */}
        {p.kindConfig.showWatchlistPanel && (<>
        <div className="app-sh">
          <h3>{accent(p.copy?.['dashboard.sec.watchlist'] ?? 'Your *watchlist*')}</h3>
          {p.watchlist.activeCountLabel && <span className="ct">{p.watchlist.activeCountLabel}</span>}
          <Link href={p.watchlist.moreHref} className="more">View all →</Link>
        </div>
        {p.watchlist.cards.length === 0 ? (
          <div className="app-wire">
            <span className="eb">— On watch for you —</span>
            <p>{p.copy?.['dashboard.empty'] ?? 'Nothing flagged yet. The strongest opportunities we spot will land here first.'}</p>
          </div>
        ) : (
          <div className="app-cards">
            {p.watchlist.cards.map((c) => <Card key={c.id} card={c} />)}
          </div>
        )}
        </>)}

        {/* (#551) Fresh leads — lead_gen only. Non-lead-gen kinds show their
            kind panels (above) instead of a prospect pipeline. */}
        {p.kindConfig.showLeadsPanel && (<>
        <div className="app-sh">
          <h3>{accent(p.copy?.['dashboard.sec.leads'] ?? 'Fresh *leads*')}</h3>
          {p.freshLeads.sublabel && <span className="ct">{p.freshLeads.sublabel}</span>}
          <Link href={p.freshLeads.moreHref} className="more">View all →</Link>
        </div>
        {p.freshLeads.cards.length === 0 ? (
          <div className="app-wire">
            <span className="eb">— On the hunt —</span>
            <p>We're lining up your next leads — fresh matches will appear here as we find them.</p>
          </div>
        ) : (
          <div className="app-cards">
            {p.freshLeads.cards.map((c) => <Card key={c.id} card={c} />)}
          </div>
        )}
        </>)}

        {/* (#377, val 2026-06-05) Account team — moved to the footer position;
            employee assignment is supporting cast, never the headline.
            Awaiting UX/UI design pass — likely becomes a small chip strip
            rather than a card row. Renders nothing if no team assigned. */}
        <TeamRow team={p.team} />
      </div>
    </>
  );
}
