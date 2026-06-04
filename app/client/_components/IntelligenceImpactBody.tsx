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
        <p className="v3-eyebrow">Your impact</p>
        <h1 className="v3-h1">What we&rsquo;ve built for you, <em>{headline}.</em></h1>
        <p className="v3-lede" style={{ fontStyle: 'normal', fontSize: 16 }}>
          Everything we learn about your market gets put to work across your channels — and tied back to real revenue
          motion. Here&rsquo;s the last {sinceDays} days.
        </p>
      </section>

      <div className="cards" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 18 }}>
        <Stat
          kicker="Insight captured"
          value={fmt(created.total)}
          caption="Distinct pieces of market, audience, and positioning intelligence we discovered and saved for you — the kind most teams never write down."
        />
        <Stat
          kicker="Put to work"
          value={fmt(activated.totalActivated)}
          caption="Times that intelligence powered something real — a pitch, a post, a commercial, a call — instead of sitting in a folder."
        />
        <Stat kicker="Revenue in motion" value={revenueValue} caption={revenueCaption} />
      </div>

      <article className="v3-card" style={{ marginTop: 14 }}>
        <p className="v3-card__p" style={{ marginBottom: 0 }}>
          The idea is simple: <span style={{ color: 'var(--cream)', fontFamily: 'var(--serif)', fontStyle: 'italic' }}>learn something once, use it everywhere.</span>{' '}
          Every insight we capture about your business can power your press, your social, your outreach, and your sales
          conversations — so the work compounds instead of starting over each month.
        </p>
      </article>
    </>
  );
}
