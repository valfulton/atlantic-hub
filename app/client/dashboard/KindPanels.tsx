/**
 * KindPanels — the engagement-kind-aware surfaces for /client/dashboard.
 *
 * Rendered ONLY for non-lead_gen engagements (lead_gen keeps its existing
 * Featured-Signal hero + watchlist + leads, untouched). Driven entirely by the
 * EngagementKindConfig the loader resolves from brand_members.engagement_kind.
 *
 * First pass (#551): the four panels are STUBS — a real, on-brand card with
 * the right title and an honest empty state. Live data wiring is the cockpit
 * task (#550). The point here is that Ron's dashboard stops showing leads and
 * starts speaking his language.
 *
 * Styling: panels reuse the canonical .app-sh / .app-wire classes from
 * app/client/_styles/app.css; the hero uses inline styles over CSS variables
 * (the same pattern ClientHero.tsx uses) so there are no hex literals here and
 * no new CSS to maintain.
 */
'use client';

import type { EngagementKind, EngagementKindConfig } from '@/lib/client/engagement_kind';

/** The kind hero — replaces the distress Featured Signal for non-lead_gen kinds.
 *  heroLabel is the headline; pipelineLabel is the "what you'll see" sub. */
export function KindHero({ config }: { config: EngagementKindConfig }) {
  return (
    <section
      className="app-kindhero"
      style={{
        background: 'linear-gradient(135deg, var(--emerald-deep) 0%, #063d30 100%)',
        color: 'var(--paper)',
        borderRadius: 16,
        padding: '22px 22px 24px',
        margin: '4px 0 6px',
        boxShadow: '0 10px 30px var(--card-shadow)'
      }}
    >
      <span
        style={{
          fontFamily: 'var(--sans)',
          fontSize: 12,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: 'var(--gold-bright)'
        }}
      >
        ✦ Your desk
      </span>
      <h2
        style={{
          fontFamily: 'var(--serif)',
          fontWeight: 500,
          fontSize: 22,
          lineHeight: 1.2,
          margin: '8px 0 6px'
        }}
      >
        {config.heroLabel}
      </h2>
      <p
        style={{
          fontFamily: 'var(--sans)',
          fontSize: 14,
          opacity: 0.86,
          margin: 0
        }}
      >
        {config.pipelineLabel}
      </p>
    </section>
  );
}

/** A single stub panel: section header (reused .app-sh) + empty state (.app-wire). */
function StubPanel({
  title,
  count,
  eyebrow,
  body
}: {
  title: string;
  count?: string;
  eyebrow: string;
  body: string;
}) {
  return (
    <>
      <div className="app-sh">
        <h3>{title}</h3>
        {count ? <span className="ct">{count}</span> : null}
      </div>
      <div className="app-wire">
        <span className="eb">{eyebrow}</span>
        <p>{body}</p>
      </div>
    </>
  );
}

/** The configured stub panels for this engagement kind, in reading order.
 *  Each is gated by its EngagementKindConfig flag, so a kind only mounts the
 *  panels it enables. lead_gen enables none of these (it renders the existing
 *  watchlist + leads instead). */
export function KindPanels({ config }: { config: EngagementKindConfig; kind?: EngagementKind }) {
  return (
    <>
      {config.showPressTouchesPanel && (
        <StubPanel
          title="Press touches"
          count="this week"
          eyebrow="— Outreach desk —"
          body="Every journalist touch we make on your behalf will land here as we log it. Live counts arrive with the cockpit build."
        />
      )}
      {config.showCaseBriefPanel && (
        <StubPanel
          title="Case brief"
          eyebrow="— The story behind the case —"
          body="The narrative your defense desk is telling the press — the through-line, the proof points, the counsel-approved lines — will live here."
        />
      )}
      {config.showDistrictHeatMap && (
        <StubPanel
          title="District heat map"
          eyebrow="— Your district —"
          body="A read on where your district is moving — the pulse behind your talking points — will appear here as we wire the live feed."
        />
      )}
      {config.showItineraryPanel && (
        <StubPanel
          title="Itinerary"
          eyebrow="— The next stop —"
          body="Each port is a chapter. The next stop and the press hit waiting there will appear here as the tour unfolds."
        />
      )}
    </>
  );
}
