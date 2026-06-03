/**
 * IntelligenceImpactBody  (#321 — client-facing trifecta mirror)
 *
 * The light, outcome-framed view of the Intelligence Created → Activated →
 * Revenue Influenced chain. Rendered by BOTH /client/intelligence (live) and
 * /admin/av/clients/[id]/preview/intelligence (operator mirror) from the same
 * loader, so the two can never drift (mirror-every-client-page rule).
 *
 * This is the "what your investment in Atlantic & Vine produced" surface — the
 * always-current companion to the Weekly Learned Digest (#320). It honours the
 * visibility-gap rule (feedback_visibility_gap): the client sees the system
 * working for them within a week, live.
 *
 * Anti-language (project_revenue_intelligence_directive): NO "AI", "objects",
 * "activation rate", or technical attribution. Lead with their outcomes in
 * plain language. No raw lists, no machinery — that's the operator's view.
 */
import type { IntelligenceTrifecta } from '@/lib/av/intelligence_metrics';

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function Stat({ kicker, value, caption }: { kicker: string; value: string; caption: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-6">
      <div className="text-[10px] uppercase tracking-[0.2em] text-brand mb-3">{kicker}</div>
      <div className="text-4xl sm:text-5xl font-semibold metric-value leading-none">{value}</div>
      <p className="text-[12.5px] text-muted mt-3 leading-relaxed">{caption}</p>
    </div>
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

  const revenueValue = revenue.dollarValueClosed > 0
    ? '$' + fmt(revenue.dollarValueClosed)
    : fmt(revenue.meetingsBooked + revenue.opportunitiesCreated);
  const revenueCaption = revenue.dollarValueClosed > 0
    ? `Won so far, with ${fmt(revenue.meetingsBooked)} meeting${revenue.meetingsBooked === 1 ? '' : 's'} booked and ${fmt(revenue.opportunitiesCreated)} live opportunit${revenue.opportunitiesCreated === 1 ? 'y' : 'ies'} moving.`
    : `Meetings booked and live opportunities moving — ${fmt(revenue.meetingsBooked)} meeting${revenue.meetingsBooked === 1 ? '' : 's'}, ${fmt(revenue.opportunitiesCreated)} opportunit${revenue.opportunitiesCreated === 1 ? 'y' : 'ies'}.`;

  return (
    <main className="w-full max-w-6xl mx-auto px-3 sm:px-4 py-6 sm:py-10">
      <section
        className="mb-8 rounded-2xl border border-border overflow-hidden"
        style={{
          background:
            'radial-gradient(120% 140% at 0% 0%, rgba(245,158,11,0.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))'
        }}
      >
        <div className="px-6 sm:px-8 py-7">
          <div className="text-[10px] uppercase tracking-[0.22em] text-brand mb-2">Your impact</div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">
            What we&apos;ve built for you, {headline}.
          </h1>
          <p className="text-muted text-sm mt-4 max-w-xl leading-relaxed">
            Everything we learn about your market gets put to work across your channels — and tied back to real revenue
            motion. Here&apos;s the last {sinceDays} days.
          </p>
        </div>
      </section>

      <div className="grid sm:grid-cols-3 gap-4">
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
        <Stat
          kicker="Revenue in motion"
          value={revenueValue}
          caption={revenueCaption}
        />
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-surface/40 px-6 py-5">
        <p className="text-[13px] text-muted leading-relaxed max-w-3xl">
          The idea is simple: <span className="text-ink">learn something once, use it everywhere.</span> Every insight we
          capture about your business can power your press, your social, your outreach, and your sales conversations —
          so the work compounds instead of starting over each month. This view stays current; your weekly digest tells
          the story in words.
        </p>
      </div>
    </main>
  );
}
