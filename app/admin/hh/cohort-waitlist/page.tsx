import { serverFetch } from '@/lib/server-fetch';
import { CohortWaitlistTable } from './CohortWaitlistTable';
import type { WaitlistEntry } from './CohortWaitlistTable';

export default async function CohortWaitlistPage() {
  const res = await serverFetch('/api/admin/hh/cohort-waitlist');
  const data: { waitlist: WaitlistEntry[] } = res.ok ? await res.json() : { waitlist: [] };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Cohort waitlist</h1>
      <p className="text-sm text-muted mb-6">{data.waitlist.length} total</p>
      <CohortWaitlistTable waitlist={data.waitlist} />
    </div>
  );
}
