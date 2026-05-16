import Link from 'next/link';
import { MetricCard } from '@/components/MetricCard';
import { serverFetch } from '@/lib/server-fetch';
import { AvLeadsTable } from './AvLeadsTable';
import type { AvLead } from './AvLeadsTable';
import { EnrichButton } from './EnrichButton';

interface Stats {
  total: number;
  byStage: { new: number; contacted: number; qualified: number; converted: number; lost: number };
  aiScored: number;
}

const STAGES = ['new', 'contacted', 'qualified', 'converted', 'lost'] as const;
const SOURCES = ['audit_form', 'csv', 'scrape', 'manual', 'api'] as const;
const ENRICHMENT_FILTERS = ['enriched', 'failed_no_domain', 'failed_no_results', 'failed_permanent', 'pending'] as const;
const SORT_KEYS = ['company', 'contact', 'email', 'industry', 'status', 'score', 'band', 'submitted', 'enriched'] as const;

export default async function AvPage({
  searchParams
}: {
  searchParams?: {
    stage?: string;
    source_type?: string;
    enrichment?: string;
    sort?: string;
    direction?: string;
  };
}) {
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

  const queryParts: [string, string][] = [];
  if (stageParam) queryParts.push(['stage', stageParam]);
  if (sourceParam) queryParts.push(['source_type', sourceParam]);
  if (enrichmentParam) queryParts.push(['enrichment', enrichmentParam]);
  queryParts.push(['sort', sortParam]);
  queryParts.push(['direction', directionParam]);
  const leadsQs = '?' + new URLSearchParams(queryParts).toString();

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

  const activeInPipeline = stats.byStage.contacted + stats.byStage.qualified;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Atlantic &amp; Vine</h1>
      <p className="text-sm text-muted mb-6">Lead pipeline · read-only in v1</p>

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
          <option value="enriched">✨ Enriched</option>
          <option value="pending">Pending (never tried)</option>
          <option value="failed_no_domain">No website on file</option>
          <option value="failed_no_results">Hunter found nothing</option>
          <option value="failed_permanent">Stopped (manual)</option>
        </select>
        {/* Preserve current sort when filtering */}
        <input type="hidden" name="sort" value={sortParam} />
        <input type="hidden" name="direction" value={directionParam} />
        <button
          type="submit"
          className="text-sm px-3 py-1.5 bg-surface border border-border rounded-md hover:border-brand text-ink transition-colors"
        >
          Filter
        </button>
        {(stageParam || sourceParam || enrichmentParam) && (
          <Link href="/admin/av" className="text-xs text-muted hover:text-ink">
            Clear filters
          </Link>
        )}
      </form>

      <div className="mb-2">
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h2 className="text-sm font-medium text-muted">
            Atlantic &amp; Vine — Audit-form leads (your business)
          </h2>
          <EnrichButton defaultLimit={5} />
        </div>
        <AvLeadsTable leads={leads} sortKey={sortParam} sortDirection={directionParam as 'asc' | 'desc'} />
      </div>
    </div>
  );
}
