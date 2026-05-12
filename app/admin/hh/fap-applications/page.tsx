import { DataTable, Column } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { serverFetch } from '@/lib/server-fetch';

interface FapApp {
  fapAppId: number;
  accountId: string;
  email: string | null;
  displayName: string | null;
  firmName: string | null;
  aumRange: string | null;
  crdNumber: string | null;
  stateRegistered: string | null;
  status: 'submitted' | 'in_review' | 'approved' | 'rejected' | 'withdrawn';
  submittedAt: string;
}

export default async function FapApplicationsPage() {
  const res = await serverFetch('/api/admin/hh/fap-applications');
  const data: { applications: FapApp[] } = res.ok ? await res.json() : { applications: [] };

  const columns: Column<FapApp>[] = [
    { key: 'email', header: 'Email', render: (r) => r.email ?? <span className="text-muted">—</span> },
    { key: 'firm', header: 'Firm', render: (r) => r.firmName ?? <span className="text-muted">—</span> },
    { key: 'aum', header: 'AUM', render: (r) => r.aumRange ?? <span className="text-muted">—</span> },
    { key: 'crd', header: 'CRD #', render: (r) => r.crdNumber ?? <span className="text-muted">—</span> },
    { key: 'state', header: 'State', render: (r) => r.stateRegistered ?? <span className="text-muted">—</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
    { key: 'submitted', header: 'Submitted', render: (r) => new Date(r.submittedAt).toLocaleDateString() }
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Founding Advisor Partner applications</h1>
      <p className="text-sm text-muted mb-6">{data.applications.length} total · verify CRD numbers on adviserinfo.sec.gov before approval</p>
      <DataTable columns={columns} rows={data.applications} emptyMessage="No applications yet." />
    </div>
  );
}
