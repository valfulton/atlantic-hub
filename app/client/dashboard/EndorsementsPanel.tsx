/**
 * EndorsementsPanel — political_campaign engagement (#717 Phase 3).
 *
 * Built against the UX/UI mock `AV_MOCK_John_White_Dashboard.html`
 * ("Endorsements" block). Pure read of `brief.endorsements` parsed by
 * `lib/client/race_data.ts`. Empty-state copy lives in the panel; populated
 * state renders cream cards with name + role + date + quote + source link.
 *
 * John's brief today has no endorsements (only a wishlist), so the panel
 * renders the honest empty state — never invented rows.
 */

import type { Endorsement } from '@/lib/client/race_data';

interface Props {
  endorsements: Endorsement[];
  /** Brief setup deep-link, so val can add endorsements without going to
   *  phpMyAdmin. */
  setupHref?: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function EndorsementsPanel({ endorsements, setupHref }: Props) {
  return (
    <section style={{ marginBottom: 26 }}>
      <h3
        style={{
          fontFamily: 'var(--serif, Fraunces, Georgia, serif)',
          fontWeight: 500,
          fontSize: '1.2rem',
          color: 'var(--ink, #14201B)',
          margin: '0 0 4px'
        }}
      >
        Endorsements
      </h3>
      <p
        style={{
          fontSize: 13,
          color: 'var(--muted, #54605A)',
          margin: '0 0 14px'
        }}
      >
        The currency of a campaign — tracked as they land.
      </p>

      {endorsements.length === 0 ? (
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
            — Once endorsements are on the books —
          </span>
          <p
            style={{
              fontSize: 14.5,
              fontWeight: 600,
              color: 'var(--ink, #14201B)',
              margin: '0 0 4px'
            }}
          >
            No endorsements logged yet
          </p>
          <p style={{ fontSize: 13, color: 'var(--muted, #54605A)', margin: 0 }}>
            Name the three you're chasing this quarter and we'll build the outreach calendar around them.
          </p>
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
              Add endorsements to your brief →
            </a>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {endorsements.map((e, i) => (
            <article
              key={`${e.name}-${i}`}
              style={{
                background: 'var(--paper, #FFFFFF)',
                border: '1px solid var(--edge, rgba(10,77,60,0.14))',
                borderRadius: 11,
                padding: '14px 18px'
              }}
            >
              {e.role && (
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
                  {e.role}
                </div>
              )}
              <div
                style={{
                  fontFamily: 'var(--serif, Fraunces, Georgia, serif)',
                  fontWeight: 500,
                  fontSize: 17,
                  color: 'var(--ink, #14201B)',
                  lineHeight: 1.25
                }}
              >
                {e.name}
              </div>
              {e.quote && (
                <blockquote
                  style={{
                    fontFamily: 'var(--serif, Fraunces, Georgia, serif)',
                    fontStyle: 'italic',
                    fontSize: 14,
                    color: 'var(--ink, #14201B)',
                    margin: '8px 0 0',
                    paddingLeft: 12,
                    borderLeft: '3px solid var(--gold, #C9A961)',
                    lineHeight: 1.5
                  }}
                >
                  {e.quote}
                </blockquote>
              )}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  marginTop: e.quote ? 10 : 6,
                  fontSize: 12,
                  color: 'var(--muted, #54605A)'
                }}
              >
                {e.date && <span>{formatDate(e.date)}</span>}
                {e.sourceUrl && (
                  <a
                    href={e.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontWeight: 600,
                      color: 'var(--emerald-deep, #0A4D3C)',
                      textDecoration: 'none',
                      borderBottom: '1px solid rgba(10,77,60,0.3)'
                    }}
                  >
                    Read more →
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
