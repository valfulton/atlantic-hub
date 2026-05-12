import { serverFetch } from '@/lib/server-fetch';
import { FapApplicationsTable } from './FapApplicationsTable';
import type { FapApp } from './FapApplicationsTable';

export default async function FapApplicationsPage() {
  const res = await serverFetch('/api/admin/hh/fap-applications');
  const data: { applications: FapApp[] } = res.ok ? await res.json() : { applications: [] };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Founding Advisor Partner applications</h1>
      <p className="text-sm text-muted mb-6">{data.applications.length} total · verify CRD numbers on adviserinfo.sec.gov before approval</p>
      <FapApplicationsTable applications={data.applications} />
    </div>
  );
}
