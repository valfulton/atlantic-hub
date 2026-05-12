'use client';
import { DataTable, Column } from '@/components/DataTable';

export interface WaitlistEntry {
  waitlistId: number;
  accountId: string;
  email: string | null;
  displayName: string | null;
  cohortTarget: string | null;
  experienceLevel: string | null;
  addedAt: string;
}

const COLUMNS: Column<WaitlistEntry>[] = [
  { key: 'email', header: 'Email', render: (r) => r.email ?? <span className="text-muted">—</span> },
  { key: 'name', header: 'Name', render: (r) => r.displayName ?? <span className="text-muted">—</span> },
  { key: 'target', header: 'Cohort target', render: (r) => r.cohortTarget ?? <span className="text-muted">—</span> },
  { key: 'xp', header: 'Experience', render: (r) => r.experienceLevel ?? <span className="text-muted">—</span> },
  { key: 'added', header: 'Added', render: (r) => new Date(r.addedAt).toLocaleDateString() }
];

export function CohortWaitlistTable({ waitlist }: { waitlist: WaitlistEntry[] }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={waitlist}
      emptyMessage="No waitlist signups yet."
    />
  );
}
