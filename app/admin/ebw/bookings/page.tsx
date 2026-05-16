import { serverFetch } from '@/lib/server-fetch';
import { AddBookingForm } from './AddBookingForm';

interface Booking {
  bookingId: number;
  bookingUuid: string;
  bookedOn: string;
  eventDate: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  market: string | null;
  groupSize: number | null;
  eventType: string | null;
  vesselPartner: string | null;
  eventPlanner: string | null;
  grossRevenue: number | null;
  ebwCommission: number | null;
  status: string;
  notes: string | null;
}

function fmtUSD(n: number | null): string {
  if (n === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export default async function EbwBookingsPage() {
  const res = await serverFetch('/api/admin/ebw/bookings');
  const { bookings }: { bookings: Booking[] } = res.ok ? await res.json() : { bookings: [] };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Bookings</h1>
      <p className="text-sm text-muted mb-6">Closed charter bookings + commission tracking. Log each one as it closes.</p>

      <AddBookingForm />

      <h2 className="text-sm font-medium text-muted mt-8 mb-3">All bookings ({bookings.length})</h2>
      {bookings.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-muted bg-surface border border-border rounded-lg">
          No bookings logged yet. Use the form above to log your first one.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-4">Booked</th>
                <th className="py-2 pr-4">Event date</th>
                <th className="py-2 pr-4">Customer</th>
                <th className="py-2 pr-4">Market</th>
                <th className="py-2 pr-4">Vessel / Planner</th>
                <th className="py-2 pr-4 text-right">Gross</th>
                <th className="py-2 pr-4 text-right">Commission</th>
                <th className="py-2 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.bookingId} className="border-b border-border">
                  <td className="py-3 pr-4 whitespace-nowrap text-xs text-muted">{b.bookedOn}</td>
                  <td className="py-3 pr-4 whitespace-nowrap text-xs">{b.eventDate || '—'}</td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{b.customerName}</div>
                    {b.customerEmail && <div className="text-xs text-muted">{b.customerEmail}</div>}
                  </td>
                  <td className="py-3 pr-4">{b.market || '—'}</td>
                  <td className="py-3 pr-4 text-xs">
                    {b.vesselPartner && <div>{b.vesselPartner}</div>}
                    {b.eventPlanner && <div className="text-muted">via {b.eventPlanner}</div>}
                  </td>
                  <td className="py-3 pr-4 text-right whitespace-nowrap">{fmtUSD(b.grossRevenue)}</td>
                  <td className="py-3 pr-4 text-right whitespace-nowrap">{fmtUSD(b.ebwCommission)}</td>
                  <td className="py-3 pr-4">
                    <span className="text-xs px-2 py-0.5 bg-surface border border-border rounded-md">
                      {b.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
