/**
 * CaseBriefPanel — the through-line of the case, for defense_pr clients.
 *
 * Reads three brief fields directly: message_support (the proof points /
 * judicial-record anchor), audience_insights (why this story lands with
 * the audience), and timeline (the press window vs. trial calendar).
 *
 * No new schema. Pure read of the brief. Operator edits at /admin/av/brief.
 *
 * Client-side empty states are honest + actionable — every missing field
 * shows a calm "Add this in the brief" line so val knows what to fill
 * without having to chase a 404 or a broken card.
 */
type Props = {
  messageSupport?: string | null;
  audienceInsights?: string | null;
  timeline?: string | null;
};

function Section({
  eyebrow,
  body,
  empty
}: {
  eyebrow: string;
  body: string | null | undefined;
  empty: string;
}) {
  const hasBody = typeof body === 'string' && body.trim().length > 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--gold-ink, #7A5A18)',
          marginBottom: 4
        }}
      >
        {eyebrow}
      </div>
      {hasBody ? (
        <p
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--ink, #0A0A0A)'
          }}
        >
          {body}
        </p>
      ) : (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontStyle: 'italic',
            color: 'var(--ink-soft, #5F5E5A)'
          }}
        >
          {empty}
        </p>
      )}
    </div>
  );
}

export default function CaseBriefPanel({
  messageSupport,
  audienceInsights,
  timeline
}: Props) {
  return (
    <>
      <div className="app-sh">
        <h3>Case brief</h3>
        <span className="ct">the story behind the case</span>
      </div>
      <div
        style={{
          background: 'var(--paper, #FFFDF5)',
          border: '0.5px solid var(--card-border, rgba(10,10,10,0.10))',
          borderRadius: 12,
          padding: '16px 18px'
        }}
      >
        <Section
          eyebrow="— The through-line —"
          body={messageSupport}
          empty="Add the proof points and judicial-record anchor in the brief (Q6 — Why should they believe it?)."
        />
        <Section
          eyebrow="— Why this lands —"
          body={audienceInsights}
          empty="Add the audience insight in the brief (Q4 — What do we know about them?)."
        />
        <Section
          eyebrow="— The window —"
          body={timeline}
          empty="Add the press window and trial calendar in the brief (Seasonality / Key dates)."
        />
        <div
          style={{
            marginTop: 10,
            paddingTop: 12,
            borderTop: '0.5px solid var(--card-border, rgba(10,10,10,0.06))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: 'var(--ink-soft, #5F5E5A)'
            }}
          >
            Edit any line at /admin/av/brief — the panel re-reads on refresh.
          </span>
          <span
            style={{
              fontSize: 10,
              padding: '3px 8px',
              borderRadius: 6,
              background: 'var(--gold-soft, #FAEEDA)',
              color: 'var(--gold-ink, #633806)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em'
            }}
          >
            Counsel sign-off before any press release
          </span>
        </div>
      </div>
    </>
  );
}
