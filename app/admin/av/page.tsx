import Link from 'next/link';
import { DataTable, Column } from '@/components/DataTable';
import { MetricCard } from '@/components/MetricCard';
import { StatusBadge } from '@/components/StatusBadge';
import { serverFetch } from '@/lib/server-fetch';

interface Lead {
  id: number;
  auditId: string;
  company: string;
  contactName: string | null;
  email: string;
  industry: string | null;
  leadStatus: string;
  aiScoreBand: string | null;
  submissionDate: string;
  sourceType: string;
  clientId: number | null;
}

interface Stats {
  total: number;
  byStage: { new: number; contacted: number; qualified: number; converted: number; lost: number };
  aiScored: number;
}

const STAGES = ['new', 'contacted', 'qualified', 'converted', 'lost'] as const;
const SOURCES = ['audit_form', 'csv', 'scrape', 'manual', 'api'] as const;

export default async function AvPage({
  searchParams
}: {
  searchParams?: { stage?: string; source_type?: string };
}) {
  const stageParam = STAGES.includes(searchParams?.stage as (typeof STAGES)[number])
    ? (searchParams!.stage as string)
    : '';
  const sourceParam = SOURCES.includes(searchParams?.source_type as (typeof SOURCES)[number])
    ? (searchParams!.source_type as string)
    : '';

  const [statsRes, leadsRes] = await Promise.all([
    serverFetch('/api/admin/av/stats'),
    serverFetch(
      '/api/admin/av/leads' +
        (stageParam || sourceParam
          ? '?' +
            new URLSearchParams(
              Object.fromEntries(
                [
                  stageParam ? ['stage', stageParam] : null,
                  sourceParam ? ['source_type', sourceParam] : null
                ].filter(Boolean) as [string, string][]
              )
            ).toString()
          : '')
    )
  ]);

  const { stats }: { stats: Stats } = statsRes.ok
    ? await statsRes.json()
    : { stats: { total: 0, byStage: { new: 0, contacted: 0, qualified: 0, converted: 0, lost: 0 }, aiScored: 0 } };

  const { leads }: { leads: Lead[] } = leadsRes.ok
    ? await leadsRes.json()
    : { leads: [] };

  const columns: Column<Lead>[] = [
    {
      key: 'company',
      header: 'Company',
      render: (r) => (
        <Link href={`/admin/av/${r.auditId}`} className="text-brand hover:underline font-medium">
          {r.company}
        </Link>
      )
    },
    {
      key: 'contact',
      header: 'Contact',
      render: (r) => r.contactName ?? <span className="text-muted">—</span>
    },
    { key: 'email', header: 'Email', render: (r) => r.email },
    {
      key: 'industry',
      header: 'Industry',
      render: (r) => r.industry ?? <span className="text-muted">—</span>
    },
    { key: 'status', header: 'Stage', render: (r) => <StatusBadge value={r.leadStatus} /> },
    {
      key: 'ai',
      header: 'AI Score',
      render: (r) =>
        r.aiScoreBand ? (
          <StatusBadge value={r.aiScoreBand} />
        ) : (
          <span className="text-muted text-xs">pending</span>
        )
    },
    {
      key: 'date',
      header: 'Submitted',
      render: (r) => new Date(r.submissionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
  ];

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

      {/* Filters */}
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
        <button
          type="submit"
          className="text-sm px-3 py-1.5 bg-surface border border-border rounded-md hover:border-brand text-ink transition-colors"
        >
          Filter
        </button>
        {(stageParam || sourceParam) && (
          <Link href="/admin/av" className="text-xs text-muted hover:text-ink">
            Clear
          </Link>
        )}
      </form>

      <div className="mb-2">
        <h2 className="text-sm font-medium text-muted mb-3">
          Atlantic &amp; Vine — Audit-form leads (your business)
        </h2>
        <DataTable
          columns={columns}
          rows={leads}
          emptyMessage="No leads match the current filter. Leads arrive via the atlanticandvine.com audit form."
        />
      </div>
    </div>
  );
}
