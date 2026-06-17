/**
 * OpponentWatchPanel — political_campaign engagement (#717 Phase 3).
 *
 * Built against the UX/UI mock `AV_MOCK_John_White_Dashboard.html` ("Watching
 * the other side" block). Filters the press_touches already loaded for the
 * dashboard to those mentioning the opponent's name. Empty-states honestly
 * when no opponent is set, or when the opponent is set but no touches
 * mention them yet. Never invents data.
 *
 * Cream card, no red anywhere (the brief's `no_red_client_surfaces` rule).
 * Single emerald-mist eyebrow chip, paper rows, gold-deep dates.
 */

import type { PressTouch } from '@/lib/client/press_touches';

interface Props {
  /** Incumbent / primary opponent. When null, render the "name your opponent"
   *  empty-state instead of the "quiet week" empty-state. */
  opponentName: string | null;
  /** All press touches loaded for this client. We filter to those mentioning
   *  opponentName in the headline or body. */
  pressTouches: PressTouch[];
  /** Brief setup deep-link — gives val a click path to confirm the opponent
   *  name without going to phpMyAdmin. */
  setupHref?: string;
}

function mentions(text: string | null | undefined, name: string): boolean {
  if (!text) return false;
  // Case-insensitive substring is good enough for surname matches like
  // "Elfreth"; future upgrade is per-token scoring.
  return text.toLowerCase().includes(name.toLowerCase());
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function OpponentWatchPanel({
  opponentName,
  pressTouches,
  setupHref
}: Props) {
  // No opponent in the brief — honest setup prompt.
  if (!opponentName) {
    return (
      <section style={{ marginBottom: 26 }}>
        <Header opponentName={null} count={0} />
        <Empty
          eyebrow="— Once the brief names your opponent —"
          title="Tell us who you're running against"
          body="When the opponent name is in your brief, we'll surface district press and public-record items about them here — factual, on the record."
          setupHref={setupHref}
        />
      </section>
    );
  }

  // Filter on the real PressTouch fields — `subject` is the headline-like
  // field, `notes` is the body-like field, `journalist` exists too but a
  // reporter name match doesn't imply the touch is ABOUT the opponent.
  const filtered = pressTouches.filter(
    (t) => mentions(t.subject, opponentName) || mentions(t.notes, opponentName)
  );

  if (filtered.length === 0) {
    return (
      <section style={{ marginBottom: 26 }}>
        <Header opponentName={opponentName} count={0} />
        <Empty
          eyebrow="— Quiet week —"
          title={`No coverage of ${opponentName} this week`}
          body="The moment district press or a public-record item mentions them, it lands here."
        />
      </section>
    );
  }

  return (
    <section style={{ marginBottom: 26 }}>
      <Header opponentName={opponentName} count={filtered.length} />
      <div
        style={{
          background: 'var(--paper, #FFFFFF)',
          border: '1px solid var(--edge, rgba(10,77,60,0.14))',
          borderRadius: 11,
          padding: '4px 18px'
        }}
      >
        {filtered.slice(0, 6).map((t, i) => (
          <div
            key={t.id}
            style={{
              padding: '14px 0',
              borderTop: i === 0 ? 'none' : '1px solid var(--edge, rgba(10,77,60,0.10))'
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--gold-deep, #7A5A18)',
                marginBottom: 4
              }}
            >
              {(t.outlet || 'Coverage') + (t.publishedAt ? ` · ${formatDate(t.publishedAt)}` : '')}
            </div>
            <div
              style={{
                fontSize: 14.5,
                fontWeight: 600,
                color: 'var(--ink, #14201B)',
                lineHeight: 1.4
              }}
            >
              {t.subject || '(untitled)'}
            </div>
            {t.notes && (
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--muted, #54605A)',
                  marginTop: 3,
                  lineHeight: 1.5
                }}
              >
                {t.notes.length > 220 ? `${t.notes.slice(0, 220)}…` : t.notes}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Header({ opponentName, count }: { opponentName: string | null; count: number }) {
  return (
    <>
      <h3
        style={{
          fontFamily: 'var(--serif, Fraunces, Georgia, serif)',
          fontWeight: 500,
          fontSize: '1.2rem',
          color: 'var(--ink, #14201B)',
          margin: '0 0 4px'
        }}
      >
        Watching the other side
      </h3>
      <p
        style={{
          fontSize: 13,
          color: 'var(--muted, #54605A)',
          margin: '0 0 14px'
        }}
      >
        {opponentName
          ? `Coverage of ${opponentName} this week${count > 0 ? ` · ${count}` : ''}.`
          : 'Coverage of your opponent, once their name is in your brief.'}
      </p>
    </>
  );
}

function Empty({
  eyebrow,
  title,
  body,
  setupHref
}: {
  eyebrow: string;
  title: string;
  body: string;
  setupHref?: string;
}) {
  return (
    <div
      style={{
        background: 'var(--paper, #FFFFFF)',
        border: '1px dashed var(--edge, rgba(10,77,60,0.18))',
        borderRadius: 11,
        padding: '18px 20px'
      }}
    >
      <span
        style={{
          display: 'inline-block',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--muted, #54605A)',
          letterSpacing: '0.04em',
          marginBottom: 6
        }}
      >
        {eyebrow}
      </span>
      <p
        style={{
          fontSize: 14.5,
          fontWeight: 600,
          color: 'var(--ink, #14201B)',
          margin: '0 0 4px'
        }}
      >
        {title}
      </p>
      <p style={{ fontSize: 13, color: 'var(--muted, #54605A)', margin: 0 }}>{body}</p>
      {setupHref && (
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
          Confirm in your brief →
        </a>
      )}
    </div>
  );
}
