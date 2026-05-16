import { serverFetch } from '@/lib/server-fetch';

interface Inquiry {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  market: string | null;
  eventDate: string | null;
  groupSize: string | null;
  eventType: string | null;
  budget: string | null;
  message: string | null;
  submittedAt: string;
}

export default async function EbwInquiriesPage() {
  const res = await serverFetch('/api/admin/ebw/inquiries');
  const { inquiries }: { inquiries: Inquiry[] } = res.ok ? await res.json() : { inquiries: [] };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Charter inquiries</h1>
      <p className="text-sm text-muted mb-6">From the booking form on eventsbywater.com · read-only</p>

      {inquiries.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-muted bg-surface border border-border rounded-lg">
          No charter inquiries yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-4">Received</th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Contact</th>
                <th className="py-2 pr-4">Market</th>
                <th className="py-2 pr-4">Event</th>
                <th className="py-2 pr-4">Budget</th>
                <th className="py-2 pr-4">Message</th>
              </tr>
            </thead>
            <tbody>
              {inquiries.map((i) => (
                <tr key={i.id} className="border-b border-border align-top">
                  <td className="py-3 pr-4 whitespace-nowrap text-xs text-muted">{new Date(i.submittedAt).toLocaleDateString()}</td>
                  <td className="py-3 pr-4 font-medium">{i.name || '—'}</td>
                  <td className="py-3 pr-4 text-xs">
                    {i.email && <div>{i.email}</div>}
                    {i.phone && <div className="text-muted">{i.phone}</div>}
                  </td>
                  <td className="py-3 pr-4">{i.market || '—'}</td>
                  <td className="py-3 pr-4">
                    {i.eventType && <div>{i.eventType}</div>}
                    {i.eventDate && <div className="text-xs text-muted">{i.eventDate}</div>}
                    {i.groupSize && <div className="text-xs text-muted">group: {i.groupSize}</div>}
                  </td>
                  <td className="py-3 pr-4 text-xs">{i.budget || '—'}</td>
                  <td className="py-3 pr-4 text-xs max-w-md">{i.message || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
