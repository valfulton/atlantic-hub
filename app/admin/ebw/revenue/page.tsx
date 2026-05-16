import { serverFetch } from '@/lib/server-fetch';
import { AddRevenueForm } from './AddRevenueForm';

interface Entry {
  revenueId: number;
  entryDate: string;
  stream: string;
  amount: number;
  source: string | null;
  bookingId: number | null;
  notes: string | null;
}
interface Sum { stream: string; ytd: number }

const STREAM_LABEL: Record<string, string> = {
  charter_commission: 'Charter commission',
  vessel_membership: 'Vessel membership',
  event_planner_subscription: 'Event planner subscription',
  corporate_retreat: 'Corporate retreat',
  vendor_network: 'Vendor network',
  atlantic_vine_services: 'Atlantic & Vine services',
  jet_charter: 'Jet charter',
  merchandise: 'Merchandise',
  investor_capital: 'Investor capital',
  other: 'Other'
};

function fmtUSD(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export default async function EbwRevenuePage() {
  const res = await serverFetch('/api/admin/ebw/revenue');
  const { entries, ytdByStream }: { entries: Entry[]; ytdByStream: Sum[] } = res.ok
    ? await res.json()
    : { entries: [], ytdByStream: [] };

  const totalYtd = ytdByStream.reduce((sum, r) => sum + r.ytd, 0);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Revenue</h1>
      <p className="text-sm text-muted mb-6">Income by stream · {fmtUSD(totalYtd)} YTD across {ytdByStream.length} streams.</p>

      {ytdByStream.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {ytdByStream.map((s) => (
            <div key={s.stream} className="bg-surface border border-border rounded-lg p-4">
              <div className="text-[10px] uppercase tracking-wider text-muted">{STREAM_LABEL[s.stream] || s.stream}</div>
              <div className="text-xl font-semibold mt-1">{fmtUSD(s.ytd)}</div>
            </div>
          ))}
        </div>
      )}

      <AddRevenueForm />

      <h2 className="text-sm font-medium text-muted mt-8 mb-3">All entries ({entries.length})</h2>
      {entries.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-muted bg-surface border border-border rounded-lg">
          No revenue logged yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Stream</th>
                <th className="py-2 pr-4 text-right">Amount</th>
                <th className="py-2 pr-4">Source</th>
                <th className="py-2 pr-4">Notes</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.revenueId} className="border-b border-border">
                  <td className="py-3 pr-4 whitespace-nowrap text-xs text-muted">{e.entryDate}</td>
                  <td className="py-3 pr-4">{STREAM_LABEL[e.stream] || e.stream}</td>
                  <td className="py-3 pr-4 text-right whitespace-nowrap font-medium">{fmtUSD(e.amount)}</td>
                  <td className="py-3 pr-4">{e.source || '—'}</td>
                  <td className="py-3 pr-4 text-xs">{e.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
