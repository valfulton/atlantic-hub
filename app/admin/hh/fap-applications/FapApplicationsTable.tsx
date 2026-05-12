'use client';
import { DataTable, Column } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';

export interface FapApp {
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

const COLUMNS: Column<FapApp>[] = [
  { key: 'email', header: 'Email', render: (r) => r.email ?? <span className="text-muted">—</span> },
  { key: 'firm', header: 'Firm', render: (r) => r.firmName ?? <span className="text-muted">—</span> },
  { key: 'aum', header: 'AUM', render: (r) => r.aumRange ?? <span className="text-muted">—</span> },
  { key: 'crd', header: 'CRD #', render: (r) => r.crdNumber ?? <span className="text-muted">—</span> },
  { key: 'state', header: 'State', render: (r) => r.stateRegistered ?? <span className="text-muted">—</span> },
  { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
  { key: 'submitted', header: 'Submitted', render: (r) => new Date(r.submittedAt).toLocaleDateString() }
];

export function FapApplicationsTable({ applications }: { applications: FapApp[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={applications}
      emptyMessage="No applications yet."
    />
  );
}
