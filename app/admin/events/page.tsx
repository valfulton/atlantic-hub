import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/server-fetch';
import { EventsTable, type SystemEvent } from './EventsTable';

export const dynamic = 'force-dynamic';

export default async function SystemEventsPage() {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') {
    redirect('/admin');
  }

  const res = await serverFetch('/api/admin/events');
  let initialEvents: SystemEvent[] = [];
  if (res.ok) {
    const json = (await res.json()) as { events: SystemEvent[] };
    initialEvents = json.events ?? [];
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">System events</h1>
      <p className="text-sm text-muted mb-6">
        Unified observability stream. Every lead insert, AI scoring run, enrichment attempt, and API
        error lands here. Most recent first. Filter by event type, status, or source to triage what
        the platform is doing in real time.
      </p>
      <EventsTable
        initialEvents={initialEvents}
        initialFilters={{ eventType: null, status: null, source: null }}
      />
    </div>
  );
}
