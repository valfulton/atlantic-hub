import { DataTable, Column } from '@/components/DataTable';
import { serverFetch } from '@/lib/server-fetch';

interface WaitlistEntry {
  waitlistId: number;
  accountId: string;
  email: string | null;
  displayName: string | null;
  cohortTarget: string | null;
  experienceLevel: string | null;
  addedAt: string;
}

export default async function CohortWaitlistPage() {
  const res = await serverFetch('/api/admin/hh/cohort-waitlist');
  const data: { waitlist: WaitlistEntry[] } = res.ok ? await res.json() : { waitlist: [] };

  const columns: Column<WaitlistEntry>[] = [
    { key: 'email', header: 'Email', render: (r) => r.email ?? <span className="text-muted">—</span> },
    { key: 'name', header: 'Name', render: (r) => r.displayName ?? <span className="text-muted">—</span> },
    { key: 'target', header: 'Cohort target', render: (r) => r.cohortTarget ?? <span className="text-muted">—</span> },
    { key: 'xp', header: 'Experience', render: (r) => r.experienceLevel ?? <span className="text-muted">—</span> },
    { key: 'added', header: 'Added', render: (r) => new Date(r.addedAt).toLocaleDateString() }
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Cohort waitlist</h1>
      <p className="text-sm text-muted mb-6">{data.waitlist.length} total</p>
      <DataTable columns={columns} rows={data.waitlist as unknown as { [k: string]: unknown }[]} emptyMessage="No waitlist signups yet." />
    </div>
  );
}
