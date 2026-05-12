import { serverFetch } from '@/lib/server-fetch';
import { ResearchApiTable } from './ResearchApiTable';
import type { Customer } from './ResearchApiTable';

export default async function ResearchApiPage() {
  const res = await serverFetch('/api/admin/hh/research-api');
  const data: { customers: Customer[] } = res.ok ? await res.json() : { customers: [] };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Research API customers</h1>
      <p className="text-sm text-muted mb-6">{data.customers.length} total · v1 read-only</p>
      <ResearchApiTable customers={data.customers} />
    </div>
  );
}
