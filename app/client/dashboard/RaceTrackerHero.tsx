/**
 * RaceTrackerHero — political_campaign engagement (#713 Phase 2).
 *
 * Replaces KindHero for political_campaign clients. Built against the UX/UI
 * mock `AV_MOCK_John_White_Dashboard.html` — cream card, 8px emerald-deep
 * left rule, gold countdown chip top-right, honest empty-state pills for
 * unconfirmed race facts. NO red anywhere (per feedback_no_red_client_surfaces).
 *
 * Data: takes a `RaceData` parsed by `lib/client/race_data.ts`. Every field
 * is optional; the renderer either shows the confirmed value (solid emerald
 * pill) or a dashed "confirming" pill. No invented facts.
 *
 * Setup link below the hero points the operator at the brief editor for
 * whichever client_id is being viewed — passed in as `setupHref`.
 */

import type { RaceData } from '@/lib/client/race_data';

interface Props {
  race: RaceData;
  /** /admin/av/clients/[id]/brief or /admin/av/brief — caller knows the URL. */
  setupHref?: string;
}

const STATUS_LABEL: Record<string, string> = {
  filed: 'Filed',
  primary: 'Primary',
  general: 'General',
  runoff: 'Runoff',
  won: 'Won'
};

function formatElectionLine(race: RaceData): string | null {
  if (!race.nextElectionDate) return null;
  const t = Date.parse(race.nextElectionDate + 'T12:00:00Z');
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const month = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  const label = race.nextElectionLabel || 'Election';
  return `${label} · ${month} ${day}, ${year}`;
}

function headline(race: RaceData): string | null {
  if (!race.candidateName) return null;
  if (race.office) return `${race.candidateName} for ${race.office}`;
  return race.candidateName;
}

export default function RaceTrackerHero({ race, setupHref }: Props) {
  // Build the pills row. Election pill is "confirmed" (emerald-mist) when
  // we have a date; "confirming" (dashed) otherwise.
  const electionLine = formatElectionLine(race);
  const partyText = race.party ? `Party · ${race.party}` : 'Party — confirming';
  const ballotText = race.ballotStatus
    ? `Status · ${STATUS_LABEL[race.ballotStatus] || race.ballotStatus}`
    : 'Ballot status — confirming';

  // Headline — if no candidate name yet, the entire hero degrades to a
  // single setup prompt rather than rendering a half-filled card.
  const h = headline(race);
  if (!h) {
    return (
      <section
        style={{
          position: 'relative',
          background: 'var(--paper, #FFFFFF)',
          border: '1px solid var(--edge, rgba(10,77,60,0.14))',
          borderLeft: '8px solid var(--emerald-deep, #0A4D3C)',
          borderRadius: 13,
          padding: '22px 24px',
          marginBottom: 24
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--gold-deep, #7A5A18)',
            marginBottom: 8
          }}
        >
          The race
        </div>
        <div style={{ fontSize: 14, color: 'var(--muted, #54605A)', marginBottom: 12 }}>
          Confirm the candidate name and the next election date and the war room lights up.
        </div>
        {setupHref && (
          <a
            href={setupHref}
            style={{
              display: 'inline-block',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--emerald-deep, #0A4D3C)',
              textDecoration: 'none',
              borderBottom: '1px solid rgba(10,77,60,0.3)'
            }}
          >
            Finish your race setup →
          </a>
        )}
      </section>
    );
  }

  return (
    <section
      style={{
        position: 'relative',
        background: 'var(--paper, #FFFFFF)',
        border: '1px solid var(--edge, rgba(10,77,60,0.14))',
        borderLeft: '8px solid var(--emerald-deep, #0A4D3C)',
        borderRadius: 13,
        padding: '22px 24px',
        marginBottom: 24
      }}
    >
      {/* Countdown chip — top-right. Only renders when we have a real day count. */}
      {race.daysToNext != null && race.daysToNext >= 0 && (
        <div
          style={{
            position: 'absolute',
            top: 20,
            right: 22,
            textAlign: 'center',
            background: 'var(--emerald-deep, #0A4D3C)',
            borderRadius: 11,
            padding: '9px 14px',
            minWidth: 78
          }}
        >
          <div
            style={{
              fontFamily: 'var(--serif, Fraunces, Georgia, serif)',
              fontWeight: 600,
              fontSize: '1.5rem',
              color: 'var(--gold-bright, #E8C25A)',
              lineHeight: 1
            }}
          >
            {race.daysToNext}
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.85)',
              marginTop: 3
            }}
          >
            {race.daysToNext === 1 ? 'day' : 'days'}
          </div>
        </div>
      )}

      <p
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--gold-deep, #7A5A18)',
          margin: '0 0 8px',
          /* Leave room for the countdown chip so the eyebrow doesn't run under it. */
          maxWidth: race.daysToNext != null ? 'calc(100% - 100px)' : '100%'
        }}
      >
        The race
      </p>
      <h2
        style={{
          fontFamily: 'var(--serif, Fraunces, Georgia, serif)',
          fontWeight: 500,
          fontSize: '1.7rem',
          lineHeight: 1.15,
          margin: '0 0 5px',
          color: 'var(--ink, #14201B)',
          maxWidth: race.daysToNext != null ? 'calc(100% - 100px)' : '100%'
        }}
      >
        {h}
      </h2>
      {race.districtLabel && (
        <p
          style={{
            fontSize: 15,
            color: 'var(--emerald-deep, #0A4D3C)',
            fontWeight: 600,
            margin: '0 0 14px'
          }}
        >
          {race.districtLabel}
        </p>
      )}

      {/* Pills — confirmed (solid emerald-mist) or confirming (dashed). */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: race.incumbentName ? 14 : 0 }}>
        {electionLine ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 12.5,
              fontWeight: 600,
              padding: '5px 12px',
              borderRadius: 6,
              color: 'var(--emerald-deep, #0A4D3C)',
              background: 'var(--emerald-mist, #EDF4F0)',
              border: '1px solid rgba(10,77,60,0.18)'
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--emerald, #1A6B52)'
              }}
            />
            {electionLine}
          </span>
        ) : (
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              padding: '5px 12px',
              borderRadius: 6,
              color: 'var(--muted, #54605A)',
              background: 'transparent',
              border: '1px dashed var(--edge, rgba(10,77,60,0.3))'
            }}
          >
            Election date — confirming
          </span>
        )}
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            padding: '5px 12px',
            borderRadius: 6,
            color: race.party ? 'var(--emerald-deep, #0A4D3C)' : 'var(--muted, #54605A)',
            background: race.party ? 'var(--emerald-mist, #EDF4F0)' : 'transparent',
            border: race.party
              ? '1px solid rgba(10,77,60,0.18)'
              : '1px dashed var(--edge, rgba(10,77,60,0.3))'
          }}
        >
          {partyText}
        </span>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            padding: '5px 12px',
            borderRadius: 6,
            color: race.ballotStatus ? 'var(--emerald-deep, #0A4D3C)' : 'var(--muted, #54605A)',
            background: race.ballotStatus ? 'var(--emerald-mist, #EDF4F0)' : 'transparent',
            border: race.ballotStatus
              ? '1px solid rgba(10,77,60,0.18)'
              : '1px dashed var(--edge, rgba(10,77,60,0.3))'
          }}
        >
          {ballotText}
        </span>
      </div>

      {race.incumbentName && (
        <p
          style={{
            fontSize: 14,
            color: 'var(--muted, #54605A)',
            margin: 0,
            paddingTop: 13,
            borderTop: '1px solid var(--edge, rgba(10,77,60,0.14))'
          }}
        >
          Running for the seat held by{' '}
          <b style={{ color: 'var(--ink, #14201B)', fontWeight: 600 }}>
            {race.incumbentName}
            {race.incumbentParty ? ` (${race.incumbentParty})` : ''}
          </b>
          .
        </p>
      )}

      {setupHref && (race.party == null || race.ballotStatus == null) && (
        <a
          href={setupHref}
          style={{
            display: 'inline-block',
            marginTop: 10,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--emerald-deep, #0A4D3C)',
            textDecoration: 'none',
            borderBottom: '1px solid rgba(10,77,60,0.3)'
          }}
        >
          Finish your race setup →
        </a>
      )}
    </section>
  );
}
