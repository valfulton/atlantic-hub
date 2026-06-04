/**
 * IntelligenceImpactBody  (#321 — client-facing trifecta mirror) · V3
 *
 * Intelligence Created → Activated → Revenue, in plain, outcome-first language.
 * Rendered by BOTH /client/intelligence (live) and the operator preview mirror
 * from the same loader (cannot drift). V3 register: owns its own Cormorant
 * eyebrow + title + lede, then three explicit `.v3-card` blocks + one quiet
 * closing card. No hero gradient, no Tailwind metric chrome.
 *
 * Anti-language (project_revenue_intelligence_directive): NO "AI", "objects",
 * "activation rate", or technical attribution — outcomes in plain words.
 */
import type { IntelligenceTrifecta } from '@/lib/av/intelligence_metrics';

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function Stat({ kicker, value, caption }: { kicker: string; value: string; caption: string }) {
  return (
    <article className="v3-card" style={{ marginBottom: 0 }}>
      <div className="v3-eyebrow" style={{ margin: '0 0 8px' }}>{kicker}</div>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 40, color: 'var(--cream)', lineHeight: 1 }}>{value}</div>
      <p className="v3-card__p" style={{ marginTop: 10, marginBottom: 0, fontSize: 13.5 }}>{caption}</p>
    </article>
  );
}

export default function IntelligenceImpactBody({
  trifecta,
  headline
}: {
  trifecta: IntelligenceTrifecta;
  headline: string;
}) {
  const { created, activated, revenue, sinceDays } = trifecta;

  const revenueValue =
    revenue.dollarValueClosed > 0
      ? '$' + fmt(revenue.dollarValueClosed)
      : fmt(revenue.meetingsBooked + revenue.opportunitiesCreated);
  const revenueCaption =
    revenue.dollarValueClosed > 0
      ? `Won so far, with ${fmt(revenue.meetingsBooked)} meeting${revenue.meetingsBooked === 1 ? '' : 's'} booked and ${fmt(revenue.opportunitiesCreated)} live opportunit${revenue.opportunitiesCreated === 1 ? 'y' : 'ies'} moving.`
      : `Meetings booked and live opportunities moving — ${fmt(revenue.meetingsBooked)} meeting${revenue.meetingsBooked === 1 ? '' : 's'}, ${fmt(revenue.opportunitiesCreated)} opportunit${revenue.opportunitiesCreated === 1 ? 'y' : 'ies'}.`;

  return (
    <>
      <section className="v3-greet">
        <p className="v3-eyebrow">Activity · last {sinceDays} days</p>
        <h1 className="v3-h1">Your account, <em>{headline}.</em></h1>
      </section>

      <div className="cards" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 18 }}>
        <Stat
          kicker="Records saved"
          value={fmt(created.total)}
          caption="Records and observations saved to this account."
        />
        <Stat
          kicker="Records used"
          value={fmt(activated.totalActivated)}
          caption="Times a saved record was used in a pitch, post, commercial, or call."
        />
        <Stat kicker="Revenue movement" value={revenueValue} caption={revenueCaption} />
      </div>
    </>
  );
}
