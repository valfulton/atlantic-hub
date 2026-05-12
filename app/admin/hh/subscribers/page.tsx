import { serverFetch } from '@/lib/server-fetch';
import { SubscribersTable } from './SubscribersTable';
import type { HhSubscriber } from './SubscribersTable';

export default async function SubscribersPage() {
  const res = await serverFetch('/api/admin/hh/subscribers');
  const data: { subscribers: HhSubscriber[] } = res.ok ? await res.json() : { subscribers: [] };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Subscribers</h1>
      <p className="text-sm text-muted mb-6">{data.subscribers.length} total · read-only in v1</p>
      <SubscribersTable subscribers={data.subscribers} />
    </div>
  );
}
