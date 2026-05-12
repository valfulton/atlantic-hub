'use client';
import { DataTable, Column } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';

export interface HhSubscriber {
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

const COLUMNS: Column<HhSubscriber>[] = [
  { key: 'email', header: 'Email', render: (r) => r.email ?? <span className="text-muted">—</span> },
  { key: 'name', header: 'Name', render: (r) => r.displayName ?? <span className="text-muted">—</span> },
  { key: 'tier', header: 'Tier', render: (r) => <StatusBadge value={r.tier} /> },
  { key: 'mrr', header: 'MRR', render: (r) => `$${(r.mrrCents / 100).toFixed(0)}` },
  { key: 'source', header: 'Source', render: (r) => r.signupSource ?? <span className="text-muted">—</span> },
  { key: 'active', header: 'Active', render: (r) => (r.isActive ? '✓' : '—') },
  { key: 'created', header: 'Joined', render: (r) => new Date(r.createdAt).toLocaleDateString() }
];

export function SubscribersTable({ subscribers }: { subscribers: HhSubscriber[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={subscribers}
      emptyMessage="No subscribers yet. Submissions arrive here once Netlify Forms webhooks are wired."
    />
  );
}
