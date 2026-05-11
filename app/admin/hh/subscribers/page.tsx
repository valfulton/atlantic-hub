import { DataTable, Column } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { serverFetch } from '@/lib/server-fetch';

interface Subscriber {
  subscriberId: number;
  accountId: string;
  email: string | null;
  displayName: string | null;
  tier: 'free' | 'member' | 'cohort';
  signupSource: string | null;
  mrrCents: number;
  isActive: boolean;
  createdAt: string;
}

export default async function SubscribersPage() {
  const res = await serverFetch('/api/admin/hh/subscribers');
  const data: { subscribers: Subscriber[] } = res.ok ? await res.json() : { subscribers: [] };

  const columns: Column<Subscriber>[] = [
    { key: 'email', header: 'Email', render: (r) => r.email ?? <span className="text-muted">—</span> },
    { key: 'name', header: 'Name', render: (r) => r.displayName ?? <span className="text-muted">—</span> },
    { key: 'tier', header: 'Tier', render: (r) => <StatusBadge value={r.tier} /> },
    { key: 'mrr', header: 'MRR', render: (r) => `$${(r.mrrCents / 100).toFixed(0)}` },
    { key: 'source', header: 'Source', render: (r) => r.signupSource ?? <span className="text-muted">—</span> },
    { key: 'active', header: 'Active', render: (r) => (r.isActive ? '✓' : '—') },
    { key: 'created', header: 'Joined', render: (r) => new Date(r.createdAt).toLocaleDateString() }
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Subscribers</h1>
      <p className="text-sm text-muted mb-6">{data.subscribers.length} total · read-only in v1</p>
      <DataTable columns={columns} rows={data.subscribers as unknown as { [k: string]: unknown }[]} emptyMessage="No subscribers yet. Submissions arrive here once Netlify Forms webhooks are wired." />
    </div>
  );
}
