import { DataTable, Column } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { serverFetch } from '@/lib/server-fetch';

interface Customer {
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

export default async function ResearchApiPage() {
  const res = await serverFetch('/api/admin/hh/research-api');
  const data: { customers: Customer[] } = res.ok ? await res.json() : { customers: [] };

  const columns: Column<Customer>[] = [
    { key: 'org', header: 'Organization', render: (r) => r.organizationName ?? <span className="text-muted">—</span> },
    { key: 'email', header: 'Contact', render: (r) => r.email ?? <span className="text-muted">—</span> },
    { key: 'usecase', header: 'Use case', render: (r) => <span className="line-clamp-2">{r.useCase ?? '—'}</span> },
    { key: 'volume', header: 'Volume', render: (r) => r.estimatedVolume ?? <span className="text-muted">—</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
    { key: 'mrr', header: 'MRR', render: (r) => `$${(r.mrrCents / 100).toFixed(0)}` },
    { key: 'created', header: 'Created', render: (r) => new Date(r.createdAt).toLocaleDateString() }
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Research API customers</h1>
      <p className="text-sm text-muted mb-6">{data.customers.length} total · v1 read-only</p>
      <DataTable columns={columns} rows={data.customers as unknown as { [k: string]: unknown }[]} emptyMessage="No Research API inquiries yet." />
    </div>
  );
}
