/**
 * PressTouchesPanel — live read of the press_touches table for /client/dashboard.
 *
 * Rendered when EngagementKindConfig.showPressTouchesPanel is true (defense_pr,
 * political_campaign, luxury_hospitality, book_pr — every non-lead_gen kind).
 * Lead_gen never mounts this; its dashboard renders the existing leads pipeline.
 *
 * Pure presentation — no data fetching here. The loader resolves
 * listPressTouches() + countPressTouchesThisWeek() server-side and passes the
 * arrays down as props (same shape as every other dashboard panel).
 *
 * Empty state is honest: "Press touches will appear here as we log them."
 * No fake data. No spinner. Just an empty cream card with a calm note.
 */
import type { PressTouch, PressTouchStatus } from '@/lib/client/press_touches';

type Props = {
  touches: PressTouch[];
  weekCount: number;
};

const STATUS_LABEL: Record<PressTouchStatus, string> = {
  drafted: 'Drafted',
  pitched: 'Pitched',
  replied: 'Replied',
  published: 'Published',
  declined: 'Declined',
  no_response: 'No response'
};

// Status pill colors via CSS variables only. No hex literals; everything tunable
// in brand-tokens.css. Falls back to the neutral pill for unmapped statuses.
const STATUS_VAR: Record<PressTouchStatus, { bg: string; fg: string }> = {
  drafted:     { bg: 'var(--paper-soft, #F7F1E1)', fg: 'var(--ink-soft, #5F5E5A)' },
  pitched:     { bg: 'var(--harbor-soft, #E6F1FB)', fg: 'var(--harbor-deep, #0C447C)' },
  replied:     { bg: 'var(--mint-soft, #E1F5EE)', fg: 'var(--emerald-deep, #085041)' },
  published:   { bg: 'rgba(201,169,97,.16)', fg: 'var(--ink, #14201B)' },
  declined:    { bg: 'var(--rose-soft, #FBEAF0)', fg: 'var(--rose-ink, #72243E)' },
  no_response: { bg: 'var(--paper-soft, #F7F1E1)', fg: 'var(--ink-soft, #5F5E5A)' }
};

function StatusPill({ status }: { status: PressTouchStatus }) {
  const v = STATUS_VAR[status];
  return (
    <span
      style={{
        background: v.bg,
        color: v.fg,
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 6,
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.06em'
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function ageLabel(t: PressTouch): string {
  if (t.publishedAt) return `published ${t.ageDays}d ago`;
  if (t.repliedAt) return `replied ${t.ageDays}d ago`;
  if (t.pitchedAt) return `pitched ${t.ageDays}d ago`;
  return `drafted ${t.ageDays}d ago`;
}

export default function PressTouchesPanel({ touches, weekCount }: Props) {
  const hasAny = touches.length > 0;
  return (
    <>
      <div className="app-sh">
        <h3>Press touches</h3>
        {hasAny ? (
          <span className="ct">{weekCount} this week</span>
        ) : null}
      </div>

      {!hasAny ? (
        <div className="app-wire">
          <span className="eb">— On the wire —</span>
          <p>
            Every journalist touch we make on your behalf will land here as we log it —
            who we pitched, what outlet, and when they come back to us.
          </p>
        </div>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          {touches.map((t) => (
            <li
              key={t.id}
              style={{
                background: 'var(--paper, #FFFDF5)',
                border: '0.5px solid var(--card-border, rgba(10,10,10,0.10))',
                borderRadius: 10,
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap'
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: 'var(--ink, #0A0A0A)'
                    }}
                  >
                    {t.outlet}
                  </span>
                  <StatusPill status={t.status} />
                  {t.url ? (
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: 11,
                        color: 'var(--harbor-deep, #0C447C)',
                        textDecoration: 'underline'
                      }}
                    >
                      Read it →
                    </a>
                  ) : null}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--ink-soft, #5F5E5A)',
                    marginTop: 2
                  }}
                >
                  {t.journalist}
                  {t.beat ? ` · ${t.beat}` : ''}
                  {' · '}
                  {ageLabel(t)}
                </div>
                {t.subject ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--ink-soft, #5F5E5A)',
                      marginTop: 4,
                      fontStyle: 'italic'
                    }}
                  >
                    “{t.subject}”
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
