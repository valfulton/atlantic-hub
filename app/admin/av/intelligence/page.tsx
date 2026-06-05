/**
 * /admin/av/intelligence  (#321 — Intelligence Trifecta)
 *
 * The business-intelligence layer, operator-only. Three stacked views of one
 * chain: Intelligence Created → Intelligence Activated → Revenue Influenced.
 * This is the surface that replaces "we built features" with "here's the
 * chain" — the 60-second walk for Mike + NDVIP. (See HANDOFF_Intelligence_
 * Trifecta.md + memory project_revenue_intelligence_directive.)
 *
 * Anti-language: this is NOT an "AI activity dashboard." Lead with revenue +
 * outcomes, never technical attribution.
 *
 * State lives in the URL so every view is shareable + bookmarkable:
 *   ?client=<id>       scope to one client (default: all clients)
 *   ?days=7|30|90      trend window (default 30)
 *   ?presentation=1    investor-deck mode (big numbers, clean spacing)
 */
import Link from 'next/link';
import { loadIntelligenceTrifecta } from '@/lib/av/intelligence_metrics';
import { listClientAccounts } from '@/lib/av/clients_overview';
import { IntelligenceExport } from './IntelligenceExport';
import type { TrifectaSparkPoint } from '@/lib/av/intelligence_metrics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const WINDOWS = [7, 30, 90] as const;

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}
function money(n: number): string {
  return '$' + n.toLocaleString('en-US');
}

/** Tiny inline trend chip. Up = amber/positive, down = muted, flat = neutral. */
function Trend({ pct }: { pct: number }) {
  if (pct === 0) return <span className="text-[11px] text-muted">no change</span>;
  const up = pct > 0;
  return (
    <span className={`text-[11px] font-medium ${up ? 'text-emerald-300' : 'text-white/40'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct)}% <span className="text-muted font-normal">vs prior</span>
    </span>
  );
}

/** Pure-SVG sparkline from a daily series. No JS, renders identically SSR. */
function Sparkline({ series, pick, stroke }: {
  series: TrifectaSparkPoint[];
  pick: (p: TrifectaSparkPoint) => number;
  stroke: string;
}) {
  const vals = series.map(pick);
  if (vals.length < 2 || vals.every((v) => v === 0)) {
    return <div className="h-10 flex items-center text-[11px] text-muted/60">— not enough signal yet —</div>;
  }
  const w = 280;
  const h = 40;
  const max = Math.max(...vals, 1);
  const step = w / (vals.length - 1);
  const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function chipCls(active: boolean): string {
  return active
    ? 'inline-flex items-center rounded-md border border-[color-mix(in_srgb,var(--gold-bright)_35%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)] px-2.5 py-1 text-[var(--gold-bright)]'
    : 'inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-ink hover:border-[color-mix(in_srgb,var(--gold-bright)_35%,transparent)] hover:text-[var(--gold-bright)]';
}

export default async function IntelligencePage({
  searchParams
}: {
  searchParams?: { client?: string; days?: string; presentation?: string };
}) {
  const clientId = searchParams?.client ? Number.parseInt(searchParams.client, 10) : undefined;
  const days = WINDOWS.includes(Number(searchParams?.days) as 7) ? Number(searchParams!.days) : 30;
  const presentation = searchParams?.presentation === '1';

  const [trifecta, clients] = await Promise.all([
    loadIntelligenceTrifecta({ clientId: clientId && clientId > 0 ? clientId : undefined, sinceDays: days }),
    listClientAccounts()
  ]);

  const qp = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const c = over.client !== undefined ? over.client : (clientId ? String(clientId) : undefined);
    const d = over.days !== undefined ? over.days : String(days);
    const pres = over.presentation !== undefined ? over.presentation : (presentation ? '1' : undefined);
    if (c) p.set('client', c);
    if (d && d !== '30') p.set('days', d);
    if (pres) p.set('presentation', pres);
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  const { created, activated, revenue, series } = trifecta;
  const scopeLabel = trifecta.clientName ?? 'All clients';

  // ── Presentation / investor-deck mode ────────────────────────────────────
  if (presentation) {
    return (
      <div className="min-h-screen p-8 sm:p-16 flex flex-col justify-center">
        <div className="flex items-center justify-between mb-12">
          <div className="text-[11px] uppercase tracking-[0.22em] text-brand">{scopeLabel} · last {days} days</div>
          <Link href={`/admin/av/intelligence${qp({ presentation: '' })}`} className="text-[12px] text-white/50 hover:text-white/80">Exit deck mode ✕</Link>
        </div>
        <div className="space-y-14 max-w-4xl mx-auto w-full">
          <DeckRow kicker="Intelligence created" big={fmt(created.total)} sub="reusable intelligence objects discovered" trend={created.trendVsPrior} />
          <DeckRow kicker="Intelligence activated" big={fmt(activated.totalActivated)} sub={`${Math.round(activated.activationRate * 100)}% of everything created reached a channel`} trend={activated.trendVsPrior} />
          <DeckRow kicker="Revenue influenced" big={revenue.dollarValueClosed > 0 ? money(revenue.dollarValueClosed) : fmt(revenue.dealsClosedWon)} sub={revenue.dollarValueClosed > 0 ? `won · ${revenue.meetingsBooked} meetings · ${revenue.opportunitiesCreated} opportunities` : `deals won · ${revenue.meetingsBooked} meetings booked`} trend={revenue.trendVsPrior} />
        </div>
        <p className="text-center text-[11px] text-muted mt-16 max-w-xl mx-auto">
          Create intelligence once, activate it everywhere. This is the chain — discovered, put to work, tied to revenue.
        </p>
      </div>
    );
  }

  // ── Standard operator view ───────────────────────────────────────────────
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Intelligence <span className="text-[var(--gold-bright)] italic">chain</span>
          </h1>
          <p className="text-sm text-white/60 mt-1 max-w-2xl">
            What the system discovered, how much of it reached a channel, and the revenue motion it&apos;s tied to.
            Create intelligence once — activate it everywhere.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <IntelligenceExport trifecta={trifecta} />
          <Link href={`/admin/av/intelligence${qp({ presentation: '1' })}`} className="text-[12px] rounded-md bg-brand text-black px-3 py-1.5 font-medium hover:opacity-90">
            Show as deck →
          </Link>
          <Link href="/admin/av" className="text-[12px] text-white/50 hover:text-white/80">← Leads</Link>
        </div>
      </div>

      {/* Controls: client filter + window */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-muted/70 uppercase tracking-[0.18em] text-[10px] mr-1">Client</span>
          <Link href={`/admin/av/intelligence${qp({ client: '' })}`} className={chipCls(!trifecta.clientId)}>All clients</Link>
          {clients.map((c) => (
            <Link key={c.clientId} href={`/admin/av/intelligence${qp({ client: String(c.clientId) })}`} className={chipCls(trifecta.clientId === c.clientId)}>
              {c.name}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-muted/70 uppercase tracking-[0.18em] text-[10px] mr-1">Window</span>
          {WINDOWS.map((w) => (
            <Link key={w} href={`/admin/av/intelligence${qp({ days: String(w) })}`} className={chipCls(days === w)}>
              {w} days
            </Link>
          ))}
        </div>
      </div>

      {/* CARD 1 — Created */}
      <ChainCard
        step="01"
        title="Intelligence created"
        blurb="Reusable intelligence the system discovered — narrative lines, authority topics, PR openings, ICP & positioning patterns, conversion insights."
        headline={fmt(created.total)}
        headlineUnit="objects"
        trend={created.trendVsPrior}
        spark={<Sparkline series={series} pick={(p) => p.created} stroke="#fbbf24" />}
        rows={[
          ['Narrative lines', created.narrativeLines],
          ['Authority topics', created.authorityTopics],
          ['PR opportunities', created.prOpportunities],
          ['ICP / positioning patterns', created.icpPatterns],
          ['Conversion insights', created.conversionInsights]
        ]}
      />

      {/* CARD 2 — Activated */}
      <ChainCard
        step="02"
        title="Intelligence activated"
        blurb="The bridge between a data lake and a working system: how much of what we created actually reached a channel."
        headline={fmt(activated.totalActivated)}
        headlineUnit={`activations · ${Math.round(activated.activationRate * 100)}% of created`}
        trend={activated.trendVsPrior}
        spark={<Sparkline series={series} pick={(p) => p.activated} stroke="#60a5fa" />}
        rows={[
          ['In PR pitches', activated.activatedInPR],
          ['In outreach', activated.activatedInOutreach],
          ['In commercials', activated.activatedInCommercials],
          ['In social', activated.activatedInSocial],
          ['In sales calls', activated.activatedInSalesCalls]
        ]}
      />

      {/* CARD 3 — Revenue */}
      <ChainCard
        step="03"
        title="Revenue influenced"
        blurb="The revenue motion tied to activated intelligence — meetings, opportunities, and closed dollars."
        headline={revenue.dollarValueClosed > 0 ? money(revenue.dollarValueClosed) : fmt(revenue.dealsClosedWon)}
        headlineUnit={revenue.dollarValueClosed > 0 ? 'won in window' : 'deals won'}
        trend={revenue.trendVsPrior}
        spark={<Sparkline series={series} pick={(p) => p.revenue} stroke="#34d399" />}
        rows={[
          ['Meetings booked', revenue.meetingsBooked],
          ['Proposals sent', revenue.proposalsSent],
          ['Opportunities created', revenue.opportunitiesCreated],
          ['Deals won', revenue.dealsClosedWon],
          ['Deals lost', revenue.dealsClosedLost]
        ]}
        footer={
          <div className="mt-4 border-t border-border pt-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted mb-2">
              Attribution — top narrative lines by activated assets
              <span className="ml-2 normal-case tracking-normal text-[color-mix(in_srgb,var(--gold-bright)_75%,transparent)]">lineage graph pending (#322)</span>
            </div>
            {revenue.attribution.length === 0 ? (
              <div className="text-[12px] text-muted/70">No linked assets in this window yet.</div>
            ) : (
              <ul className="space-y-1">
                {revenue.attribution.map((a) => (
                  <li key={a.narrativeLineId} className="flex items-center justify-between text-[12.5px]">
                    <Link href={`/admin/av/narrative`} className="text-ink hover:text-[var(--gold-bright)] truncate pr-3">{a.narrativeLine}</Link>
                    <span className="text-muted shrink-0">{a.activatedAssets} asset{a.activatedAssets === 1 ? '' : 's'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        }
      />

      <p className="text-[11px] text-muted/70 max-w-2xl">
        Scope: <span className="text-ink">{scopeLabel}</span>, last {days} days. Activation rate is activated ÷ created in
        the same window. Full per-object revenue attribution unlocks when the lineage graph (#322) ships; today&apos;s
        attribution shows narrative lines by linked assets.
      </p>
    </div>
  );
}

function DeckRow({ kicker, big, sub, trend }: { kicker: string; big: string; sub: string; trend: number }) {
  return (
    <div>
      <div className="text-[12px] uppercase tracking-[0.22em] text-brand mb-2">{kicker}</div>
      <div className="flex items-end gap-4 flex-wrap">
        <div className="text-6xl sm:text-7xl font-semibold metric-value leading-none">{big}</div>
        <div className="pb-2"><Trend pct={trend} /></div>
      </div>
      <div className="text-sm text-muted mt-2">{sub}</div>
    </div>
  );
}

function ChainCard({
  step, title, blurb, headline, headlineUnit, trend, spark, rows, footer
}: {
  step: string;
  title: string;
  blurb: string;
  headline: string;
  headlineUnit: string;
  trend: number;
  spark: React.ReactNode;
  rows: [string, number][];
  footer?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface/60 overflow-hidden">
      <div className="grid md:grid-cols-[1.1fr_1fr] gap-0">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] tabular-nums text-[color-mix(in_srgb,var(--gold-bright)_60%,transparent)]">{step}</span>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
          </div>
          <p className="text-[12.5px] text-muted leading-relaxed max-w-md">{blurb}</p>
          <div className="mt-4 flex items-end gap-3 flex-wrap">
            <div className="text-4xl font-semibold metric-value leading-none">{headline}</div>
            <div className="pb-1 text-[11px] text-muted">{headlineUnit}</div>
          </div>
          <div className="mt-2"><Trend pct={trend} /></div>
          <div className="mt-3">{spark}</div>
        </div>
        <div className="p-6 md:border-l border-border bg-black/10">
          <ul className="space-y-2">
            {rows.map(([label, val]) => (
              <li key={label} className="flex items-center justify-between text-[13px]">
                <span className="text-muted">{label}</span>
                <span className="text-ink tabular-nums font-medium">{val.toLocaleString('en-US')}</span>
              </li>
            ))}
          </ul>
          {footer}
        </div>
      </div>
    </section>
  );
}
