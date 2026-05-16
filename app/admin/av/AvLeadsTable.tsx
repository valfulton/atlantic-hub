'use client';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { DataTable, Column } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';

export interface AvLead {
  id: number;
  auditId: string;
  company: string;
  contactName: string | null;
  contactTitle: string | null;
  email: string;
  industry: string | null;
  leadStatus: string;
  aiScore: number | null;
  aiScoreBand: string | null;
  submissionDate: string;
  sourceType: string;
  clientId: number | null;
  enrichmentStatus: string | null;
  enrichedAt: string | null;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function EnrichmentCell({ lead }: { lead: AvLead }) {
  const s = lead.enrichmentStatus;
  if (s === 'enriched') {
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <span className="text-amber-400">✨</span>
        <span className="text-muted">{formatRelative(lead.enrichedAt)}</span>
      </span>
    );
  }
  if (s === 'failed_no_domain') {
    return <span className="text-[10px] uppercase tracking-wider text-muted">no website</span>;
  }
  if (s === 'failed_no_results') {
    return <span className="text-[10px] uppercase tracking-wider text-muted">no results</span>;
  }
  if (s === 'in_progress') {
    return <span className="text-[10px] uppercase tracking-wider text-amber-300">in progress</span>;
  }
  if (s === 'failed_permanent') {
    return <span className="text-[10px] uppercase tracking-wider text-red-400">stopped</span>;
  }
  return <span className="text-xs text-muted/60">—</span>;
}

interface SortableHeaderProps {
  label: string;
  sortKey: string;
  currentSort: string;
  currentDirection: 'asc' | 'desc';
}

function SortableHeader({ label, sortKey, currentSort, currentDirection }: SortableHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const isActive = currentSort === sortKey;
  const nextDirection = isActive && currentDirection === 'asc' ? 'desc' : 'asc';
  const arrow = isActive ? (currentDirection === 'asc' ? ' ↑' : ' ↓') : '';

  function handleClick() {
    const next = new URLSearchParams(params.toString());
    next.set('sort', sortKey);
    next.set('direction', nextDirection);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <button
      onClick={handleClick}
      className={`text-left text-xs uppercase tracking-wider font-medium hover:text-ink transition-colors ${
        isActive ? 'text-ink' : 'text-muted'
      }`}
    >
      {label}
      <span className="inline-block w-3">{arrow}</span>
    </button>
  );
}

export function AvLeadsTable({
  leads,
  sortKey = 'submitted',
  sortDirection = 'desc'
}: {
  leads: AvLead[];
  sortKey?: string;
  sortDirection?: 'asc' | 'desc';
}) {
  const COLUMNS: Column<AvLead>[] = [
    {
      key: 'company',
      header: <SortableHeader label="Company" sortKey="company" currentSort={sortKey} currentDirection={sortDirection} />,
      render: (r) => (
        <Link href={`/admin/av/${r.auditId}`} className="text-brand hover:underline font-medium">
          {r.company}
        </Link>
      )
    },
    {
      key: 'contact',
      header: <SortableHeader label="Contact" sortKey="contact" currentSort={sortKey} currentDirection={sortDirection} />,
      render: (r) => (
        <div>
          <div>{r.contactName ?? <span className="text-muted">—</span>}</div>
          {r.contactTitle && <div className="text-xs text-muted">{r.contactTitle}</div>}
        </div>
      )
    },
    {
      key: 'email',
      header: <SortableHeader label="Email" sortKey="email" currentSort={sortKey} currentDirection={sortDirection} />,
      render: (r) => <span className="text-sm">{r.email}</span>
    },
    {
      key: 'industry',
      header: <SortableHeader label="Industry" sortKey="industry" currentSort={sortKey} currentDirection={sortDirection} />,
      render: (r) => r.industry ?? <span className="text-muted">—</span>
    },
    {
      key: 'status',
      header: <SortableHeader label="Stage" sortKey="status" currentSort={sortKey} currentDirection={sortDirection} />,
      render: (r) => <StatusBadge value={r.leadStatus} />
    },
    {
      key: 'ai',
      header: <SortableHeader label="AI Score" sortKey="score" currentSort={sortKey} currentDirection={sortDirection} />,
      render: (r) =>
        r.aiScoreBand ? (
          <div className="flex items-center gap-1.5">
            <StatusBadge value={r.aiScoreBand} />
            {r.aiScore !== null && <span className="text-xs text-muted">{r.aiScore}</span>}
          </div>
        ) : (
          <span className="text-muted text-xs">pending</span>
        )
    },
    {
      key: 'enrichment',
      header: <SortableHeader label="Enriched" sortKey="enriched" currentSort={sortKey} currentDirection={sortDirection} />,
      render: (r) => <EnrichmentCell lead={r} />
    },
    {
      key: 'date',
      header: <SortableHeader label="Submitted" sortKey="submitted" currentSort={sortKey} currentDirection={sortDirection} />,
      render: (r) =>
        new Date(r.submissionDate).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        })
    }
  ];

  return (
    <DataTable
      columns={COLUMNS}
      rows={leads}
      emptyMessage="No leads match the current filter. Leads arrive via the atlanticandvine.com audit form."
    />
  );
}
