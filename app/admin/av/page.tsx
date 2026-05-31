import Link from 'next/link';
import { headers } from 'next/headers';
import { MetricCard } from '@/components/MetricCard';
import { serverFetch } from '@/lib/server-fetch';
import { AvLeadsTable } from './AvLeadsTable';
import type { AvLead } from './AvLeadsTable';
import { EnrichButton } from './EnrichButton';
import { BatchEnrichAllButton } from './BatchEnrichAllButton';
import { VendorStatus } from './VendorStatus';
import { CoachCallsButton } from './CoachCallsButton';
import { LeadOfTheDay } from '@/components/LeadOfTheDay';
import { HotLeadConfetti } from '@/components/HotLeadConfetti';
import { PipelineValueCard } from '@/components/PipelineValueCard';
import { QuickScrapeWidget } from './QuickScrapeWidget';
import { InvestorsMenu } from './InvestorsMenu';
import { OpportunityFlagsMenu } from './OpportunityFlagsMenu';
import { listOpportunityFlags } from '@/lib/av/opportunity_flags';
import { listClientAccounts } from '@/lib/av/clients_overview';
import { getHunterCreditStatus } from '@/lib/enrichment/enricher';

interface Stats {
  total: number;
  byStage: { new: number; contacted: number; qualified: number; converted: number; lost: number };
  aiScored: number;
}

const STAGES = ['new', 'contacted', 'qualified', 'converted', 'lost'] as const;
const SOURCES = ['audit_form', 'csv', 'scrape', 'manual', 'api'] as const;
// (#290) Filter values include star-enrich (Smart/Places/IG/WHOIS) awareness
// alongside the original Hunter-status values. Star-* options key off
// source_payload.enriched_from_* markers; see /api/admin/av/leads/route.ts.
const ENRICHMENT_FILTERS = [
  'enriched',
  'failed_no_domain',
  'failed_no_results',
  'failed_permanent',
  'pending',
  'star_tried',
  'star_untried',
  'neither',
  'both'
] as const;
const SORT_KEYS = ['company', 'contact', 'email', 'industry', 'status', 'score', 'band', 'submitted', 'enriched'] as const;

const DATA_FILTERS = ['has_real_email', 'has_phone', 'has_website', 'has_contact_name'] as const;
type DataFilter = (typeof DATA_FILTERS)[number];
const DATA_FILTER_LABELS: Record<DataFilter, string> = {
  has_real_email: 'Real email',
  has_phone: 'Phone',
  has_website: 'Website',
  has_contact_name: 'Contact name'
};

const TARGETS = ['av', 'ebw', 'both'] as const;
type TargetOption = (typeof TARGETS)[number];
const TARGET_LABELS: Record<TargetOption, string> = {
  av: 'Atlantic & Vine',
  ebw: 'Events by Water',
  both: 'Both pipelines'
};

export default async function AvPage({
  searchParams
}: {
  searchParams?: {
    stage?: string;
    source_type?: string;
    enrichment?: string;
    sort?: string;
    direction?: string;
    data?: string;
    target?: string;
    assignedTo?: string;
    handedToOwner?: string;
    client?: string;
  };
}) {
  // (#250) Surface live credit status + actor role so EnrichButton can render
  // its inline badge, gate the owner-only "raise ceiling" override, and skip
  // the run when credits are exhausted (no point hitting the API to learn it).
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  const hunter = await getHunterCreditStatus().catch(() => ({ used: 0, ceiling: 0, remaining: 0, source: 'estimate' as const }));

  const stageParam = STAGES.includes(searchParams?.stage as (typeof STAGES)[number])
    ? (searchParams!.stage as string)
    : '';
  const sourceParam = SOURCES.includes(searchParams?.source_type as (typeof SOURCES)[number])
    ? (searchParams!.source_type as string)
    : '';
  const enrichmentParam = ENRICHMENT_FILTERS.includes(
    searchParams?.enrichment as (typeof ENRICHMENT_FILTERS)[number]
  )
    ? (searchParams!.enrichment as string)
    : '';
  const sortParam = SORT_KEYS.includes(searchParams?.sort as (typeof SORT_KEYS)[number])
    ? (searchParams!.sort as string)
    : 'submitted';
  const directionParam = searchParams?.direction === 'asc' ? 'asc' : 'desc';

  const dataParam: DataFilter[] = (searchParams?.data ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is DataFilter => DATA_FILTERS.includes(s as DataFilter));
  const activeDataFilters = new Set<DataFilter>(dataParam);
  const dataQs = dataParam.length > 0 ? dataParam.join(',') : '';

  const targetParam: TargetOption | '' = TARGETS.includes(searchParams?.target as TargetOption)
    ? (searchParams!.target as TargetOption)
    : '';

  const assignedToParam =
    searchParams?.assignedTo === 'me' || searchParams?.assignedTo === 'unassigned'
      ? searchParams!.assignedTo
      : /^\d+$/.test(searchParams?.assignedTo ?? '')
      ? (searchParams!.assignedTo as string)
      : '';
  const handedToOwnerParam =
    searchParams?.handedToOwner === 'true' ? 'true' : '';
  const clientParam =
    searchParams?.client === 'unassigned'
      ? 'unassigned'
      : /^\d+$/.test(searchParams?.client ?? '')
      ? (searchParams!.client as string)
      : '';

  const queryParts: [string, string][] = [];
  if (stageParam) queryParts.push(['stage', stageParam]);
  if (sourceParam) queryParts.push(['source_type', sourceParam]);
  if (enrichmentParam) queryParts.push(['enrichment', enrichmentParam]);
  if (targetParam) queryParts.push(['target', targetParam]);
  if (dataQs) queryParts.push(['data', dataQs]);
  if (assignedToParam) queryParts.push(['assignedTo', assignedToParam]);
  if (handedToOwnerParam) queryParts.push(['handedToOwner', handedToOwnerParam]);
  if (clientParam) queryParts.push(['client', clientParam]);
  queryParts.push(['sort', sortParam]);
  queryParts.push(['direction', directionParam]);
  const leadsQs = '?' + new URLSearchParams(queryParts).toString();

  // Build a target-toggle URL — clicking the same chip clears it.
  function buildTargetUrl(target: TargetOption): string {
    const qp = new URLSearchParams();
    if (stageParam) qp.set('stage', stageParam);
    if (sourceParam) qp.set('source_type', sourceParam);
    if (enrichmentParam) qp.set('enrichment', enrichmentParam);
    if (clientParam) qp.set('client', clientParam);
    if (dataQs) qp.set('data', dataQs);
    qp.set('sort', sortParam);
    qp.set('direction', directionParam);
    if (targetParam !== target) qp.set('target', target);
    return `/admin/av?${qp.toString()}`;
  }

  // Build a URL that toggles a single data-completeness filter while preserving
  // all other filters + sort. Used by the chips below.
  function buildToggleUrl(filter: DataFilter): string {
    const next = new Set(activeDataFilters);
    if (next.has(filter)) next.delete(filter);
    else next.add(filter);
    const qp = new URLSearchParams();
    if (stageParam) qp.set('stage', stageParam);
    if (sourceParam) qp.set('source_type', sourceParam);
    if (enrichmentParam) qp.set('enrichment', enrichmentParam);
    if (targetParam) qp.set('target', targetParam);
    if (clientParam) qp.set('client', clientParam);
    qp.set('sort', sortParam);
    qp.set('direction', directionParam);
    if (next.size > 0) qp.set('data', Array.from(next).join(','));
    return `/admin/av?${qp.toString()}`;
  }

  const [statsRes, leadsRes] = await Promise.all([
    serverFetch('/api/admin/av/stats'),
    serverFetch('/api/admin/av/leads' + leadsQs)
  ]);

  const { stats }: { stats: Stats } = statsRes.ok
    ? await statsRes.json()
    : { stats: { total: 0, byStage: { new: 0, contacted: 0, qualified: 0, converted: 0, lost: 0 }, aiScored: 0 } };

  const { leads }: { leads: AvLead[] } = leadsRes.ok
    ? await leadsRes.json()
    : { leads: [] };

  // Client list for the "by client" filter dropdown.
  const clientAccounts = await listClientAccounts().catch(() => []);

  // (#296) Opportunity flags — leads that heated up in the last 24h. Read-only
  // single-query feed, never throws (returns [] on any DB issue). Feeds the
  // Hot inbox dropdown in the header.
  const opportunityFlags = await listOpportunityFlags().catch(() => []);

  const activeInPipeline = stats.byStage.contacted + stats.byStage.qualified;

  // Pick today's hot-lead candidates for the once-per-day celebration.
  // Server filters to "arrived in the last 24h AND ai_score > 85" so the
  // client component only needs to gate on the once-per-day flag.
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - ONE_DAY_MS;
  const confettiCandidates = leads
    .filter((l) => {
      if (l.aiScore === null || l.aiScore < 86) return false;
      const ts = new Date(l.submissionDate).getTime();
      return !Number.isNaN(ts) && ts >= cutoff;
    })
    .map((l) => ({ auditId: l.auditId, company: l.company, aiScore: l.aiScore as number }));

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 mb-1">
        <h1 className="text-2xl font-semibold">Atlantic &amp; Vine</h1>
        <div className="flex items-center gap-3 shrink-0">
          {/* (#296) Hot inbox — leads that heated up in the last 24h.
              Quietly neutral when empty; flips to bg-brand text-black
              with a count badge when there's something worth glancing at. */}
          <OpportunityFlagsMenu flags={opportunityFlags} />
          {/* (#294) Curated investor tour — one-click access to the
              demo-worthy surfaces. Sits in the top-right next to
              Intel freshness so it's always one click away during a
              live walkthrough. */}
          <InvestorsMenu />
          {/* (#295) Conductor — val's command bar for shaping how a
              Claude chat behaves before she writes the first ask.
              Modes copy directive prompts to clipboard. */}
          <Link
            href="/admin/av/conductor"
            className="text-[12px] text-white/50 hover:text-amber-300 transition"
            title="Mode buttons: ship-only, design-first, parallel-agents, campaign-bundle, memory-pack"
          >
            🎼 Conductor →
          </Link>
          <Link
            href="/admin/av/intel-freshness"
            className="text-[12px] text-white/50 hover:text-amber-300 transition"
          >
            Intel freshness →
          </Link>
        </div>
      </div>
      <p className="text-sm text-muted mb-6">Lead pipeline · read-only in v1</p>

      {/* Quick-add via smart scraper — same engine as Find new leads, surfaced
          right where val is when she spots a URL worth chasing (NDVIP). */}
      <QuickScrapeWidget />

      <HotLeadConfetti candidates={confettiCandidates} />
      <PipelineValueCard />
      <LeadOfTheDay />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Total leads" value={String(stats.total)} />
        <MetricCard label="New" value={String(stats.byStage.new)} />
        <MetricCard
          label="In pipeline"
          value={String(activeInPipeline)}
          hint="contacted + qualified"
        />
        <MetricCard
          label="AI scored"
          value={String(stats.aiScored)}
          hint={stats.total > 0 ? `${Math.round((stats.aiScored / stats.total) * 100)}% of leads` : undefined}
        />
      </div>

      <form method="GET" action="/admin/av" className="flex flex-wrap gap-3 mb-4 items-center">
        <select
          name="stage"
          defaultValue={stageParam}
          className="text-sm bg-surface border border-border rounded-md px-3 py-1.5 text-ink"
        >
          <option value="">All stages</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
        <select
          name="source_type"
          defaultValue={sourceParam}
          className="text-sm bg-surface border border-border rounded-md px-3 py-1.5 text-ink"
        >
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          name="enrichment"
          defaultValue={enrichmentParam}
          className="text-sm bg-surface border border-border rounded-md px-3 py-1.5 text-ink"
        >
          <option value="">All enrichment states</option>
          <optgroup label="Combined">
            <option value="neither">⚪️ Neither tried (true cold)</option>
            <option value="both">✨ Both Hunter + star ran</option>
          </optgroup>
          <optgroup label="Star enrich (Smart/Places/IG/WHOIS)">
            <option value="star_tried">⭐ Star tried (any source)</option>
            <option value="star_untried">⭐ Star NOT tried yet</option>
          </optgroup>
          <optgroup label="Hunter enrichment">
            <option value="enriched">✨ Hunter enriched</option>
            <option value="pending">Hunter never tried</option>
            <option value="failed_no_domain">Hunter: no website on file</option>
            <option value="failed_no_results">Hunter: found nothing</option>
            <option value="failed_permanent">Hunter: stopped (manual)</option>
          </optgroup>
        </select>
        <select
          name="client"
          defaultValue={clientParam}
          className="text-sm bg-surface border border-border rounded-md px-3 py-1.5 text-ink"
        >
          <option value="">All clients + AV</option>
          <option value="unassigned">Your AV pipeline (unassigned)</option>
          {clientAccounts.map((c) => (
            <option key={c.clientId} value={String(c.clientId)}>
              {c.name}
            </option>
          ))}
        </select>
        {/* Preserve current sort + data + target filters when filtering */}
        <input type="hidden" name="sort" value={sortParam} />
        <input type="hidden" name="direction" value={directionParam} />
        {dataQs && <input type="hidden" name="data" value={dataQs} />}
        {targetParam && <input type="hidden" name="target" value={targetParam} />}
        <button
          type="submit"
          className="text-sm px-3 py-1.5 bg-surface border border-border rounded-md hover:border-brand text-ink transition-colors"
        >
          Filter
        </button>
        {(stageParam || sourceParam || enrichmentParam || dataParam.length > 0 || targetParam || clientParam) && (
          <Link href="/admin/av" className="text-xs text-muted hover:text-ink">
            Clear filters
          </Link>
        )}
      </form>

      {/* Target-business chips — single-select (clicking active chip clears it).
          'AV' shows av + both; 'EBW' shows ebw + both; 'Both' shows only the
          dual-pipeline leads. Useful for triaging which prospects buy what. */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs uppercase tracking-wider text-muted mr-1">Pipeline:</span>
        {TARGETS.map((t) => {
          const active = targetParam === t;
          return (
            <Link
              key={t}
              href={buildTargetUrl(t)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                active
                  ? 'bg-brand/20 border-brand text-ink'
                  : 'bg-surface border-border text-muted hover:border-brand/50 hover:text-ink'
              }`}
            >
              {active ? '✓ ' : ''}
              {TARGET_LABELS[t]}
            </Link>
          );
        })}
      </div>

      {/* Sales-team chips: My leads + Owner queue */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs uppercase tracking-wider text-muted mr-1">Sales:</span>
        {(() => {
          const baseQp = new URLSearchParams();
          if (stageParam) baseQp.set('stage', stageParam);
          if (sourceParam) baseQp.set('source_type', sourceParam);
          if (enrichmentParam) baseQp.set('enrichment', enrichmentParam);
          if (targetParam) baseQp.set('target', targetParam);
          if (dataQs) baseQp.set('data', dataQs);
          baseQp.set('sort', sortParam);
          baseQp.set('direction', directionParam);

          const meActive = assignedToParam === 'me';
          const unassignedActive = assignedToParam === 'unassigned';
          const ownerActive = handedToOwnerParam === 'true';

          const meQp = new URLSearchParams(baseQp);
          if (!meActive) meQp.set('assignedTo', 'me');
          if (handedToOwnerParam) meQp.set('handedToOwner', handedToOwnerParam);

          const unQp = new URLSearchParams(baseQp);
          if (!unassignedActive) unQp.set('assignedTo', 'unassigned');
          if (handedToOwnerParam) unQp.set('handedToOwner', handedToOwnerParam);

          const ownerQp = new URLSearchParams(baseQp);
          if (assignedToParam) ownerQp.set('assignedTo', assignedToParam);
          if (!ownerActive) ownerQp.set('handedToOwner', 'true');

          const chipClass = (active: boolean) =>
            `text-xs px-2.5 py-1 rounded-full border transition-colors ${
              active
                ? 'bg-brand/20 border-brand text-ink'
                : 'bg-surface border-border text-muted hover:border-brand/50 hover:text-ink'
            }`;

          return (
            <>
              <Link href={`/admin/av?${meQp.toString()}`} className={chipClass(meActive)}>
                {meActive ? 'on -- ' : ''}My leads
              </Link>
              <Link href={`/admin/av?${unQp.toString()}`} className={chipClass(unassignedActive)}>
                {unassignedActive ? 'on -- ' : ''}Unassigned
              </Link>
              <Link href={`/admin/av?${ownerQp.toString()}`} className={chipClass(ownerActive)}>
                {ownerActive ? 'on -- ' : ''}Owner queue
              </Link>
            </>
          );
        })()}
      </div>

      {/* Data-completeness chips — toggle one or many. Combined with AND on the server. */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs uppercase tracking-wider text-muted mr-1">Has:</span>
        {DATA_FILTERS.map((f) => {
          const active = activeDataFilters.has(f);
          return (
            <Link
              key={f}
              href={buildToggleUrl(f)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                active
                  ? 'bg-brand/20 border-brand text-ink'
                  : 'bg-surface border-border text-muted hover:border-brand/50 hover:text-ink'
              }`}
            >
              {active ? '✓ ' : ''}
              {DATA_FILTER_LABELS[f]}
            </Link>
          );
        })}
        {dataParam.length > 0 && (
          <span className="text-[10px] uppercase tracking-wider text-muted/70 ml-1">
            ({dataParam.length} active · AND)
          </span>
        )}
      </div>

      <div className="mb-2">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-sm font-medium text-muted">
            Atlantic &amp; Vine — Audit-form leads (your business)
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <CoachCallsButton defaultLimit={25} />
            {/* (#250) Pass live credit-remaining + role so the button shows an
                inline badge ("Enrich next 5 · 14 left"), surfaces an owner-only
                "raise ceiling" override, and translates HTTP 401/403/cap-hit
                into honest copy instead of the previous raw 'unauthorized'. */}
            <EnrichButton
              defaultLimit={5}
              // (#287) Only pass credit numbers when they came from Hunter
              // live. The local estimate over-counts so we'd grey out the
              // button based on a lie. When unknown, let Hunter itself
              // reject the request if actually out.
              creditsRemaining={hunter.source === 'live' ? hunter.remaining : undefined}
              monthlyCeiling={hunter.source === 'live' ? hunter.ceiling : undefined}
              isOwner={role === 'owner'}
            />
            {/* (#278) Bulk version of the per-lead Enrich-from-sources menu.
                Runs Smart enrich + Places + IG + WHOIS on N leads at once,
                with per-source + per-lead result chips so val sees exactly
                what each lead got. Hunter is NOT included here — uses the
                button to the left for that (credits cost money).

                (#279) Now scoped to the leads VISIBLE in the current filter.
                The cockpit already fetched `leads` for the table; we just
                pass their audit_ids so the batch enriches exactly what val
                is staring at, not some arbitrary "stalest" auto-pick. */}
            <BatchEnrichAllButton visibleLeadAuditIds={leads.map((l) => l.auditId)} />
          </div>
        </div>
        <VendorStatus />
        <AvLeadsTable leads={leads} sortKey={sortParam} sortDirection={directionParam as 'asc' | 'desc'} />
      </div>
    </div>
  );
}
