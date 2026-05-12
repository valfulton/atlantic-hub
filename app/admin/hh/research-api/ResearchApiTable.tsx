'use client';
import { DataTable, Column } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';

export interface Customer {
  customerId: number;
  accountId: string;
  email: string | null;
  displayName: string | null;
  organizationName: string | null;
  useCase: string | null;
  estimatedVolume: string | null;
  status: 'inquiry' | 'pilot' | 'active' | 'churned';
  mrrCents: number;
  createdAt: string;
}

const COLUMNS: Column<Customer>[] = [
  { key: 'org', header: 'Organization', render: (r) => r.organizationName ?? <span className="text-muted">—</span> },
  { key: 'email', header: 'Contact', render: (r) => r.email ?? <span className="text-muted">—</span> },
  { key: 'usecase', header: 'Use case', render: (r) => <span className="line-clamp-2">{r.useCase ?? '—'}</span> },
  { key: 'volume', header: 'Volume', render: (r) => r.estimatedVolume ?? <span className="text-muted">—</span> },
  { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
  { key: 'mrr', header: 'MRR', render: (r) => `$${(r.mrrCents / 100).toFixed(0)}` },
  { key: 'created', header: 'Created', render: (r) => new Date(r.createdAt).toLocaleDateString() }
];

export function ResearchApiTable({ customers }: { customers: Customer[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={customers}
      emptyMessage="No Research API inquiries yet."
    />
  );
}
