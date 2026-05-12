'use client';
import Link from 'next/link';
import { DataTable, Column } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';

export interface AvLead {
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

const COLUMNS: Column<AvLead>[] = [
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
    render: (r) =>
      new Date(r.submissionDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
  }
];

export function AvLeadsTable({ leads }: { leads: AvLead[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={leads}
      emptyMessage="No leads match the current filter. Leads arrive via the atlanticandvine.com audit form."
    />
  );
}
