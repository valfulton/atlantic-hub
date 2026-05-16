import { serverFetch } from '@/lib/server-fetch';

interface Investor {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  location: string;
  investmentInterest: string | null;
  ndaSigned: boolean;
  signedDate: string | null;
  submittedAt: string;
}

export default async function EbwInvestorsPage() {
  const res = await serverFetch('/api/admin/ebw/investors');
  const { investors }: { investors: Investor[] } = res.ok ? await res.json() : { investors: [] };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Investors</h1>
      <p className="text-sm text-muted mb-6">NDA-signed investor registrations from the investor portal · read-only.</p>

      {investors.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-muted bg-surface border border-border rounded-lg">
          No investor registrations yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Contact</th>
                <th className="py-2 pr-4">Location</th>
                <th className="py-2 pr-4">Investment interest</th>
                <th className="py-2 pr-4">NDA</th>
                <th className="py-2 pr-4">Signed</th>
                <th className="py-2 pr-4">Registered</th>
              </tr>
            </thead>
            <tbody>
              {investors.map((i) => (
                <tr key={i.id} className="border-b border-border align-top">
                  <td className="py-3 pr-4 font-medium">{i.name || '—'}</td>
                  <td className="py-3 pr-4 text-xs">
                    {i.email && <div>{i.email}</div>}
                    {i.phone && <div className="text-muted">{i.phone}</div>}
                  </td>
                  <td className="py-3 pr-4">{i.location || '—'}</td>
                  <td className="py-3 pr-4 max-w-xs text-xs">{i.investmentInterest || '—'}</td>
                  <td className="py-3 pr-4">
                    {i.ndaSigned ? (
                      <span className="text-xs px-2 py-0.5 bg-green-100 text-green-800 rounded-md">signed</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 bg-surface border border-border text-muted rounded-md">unsigned</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-xs">{i.signedDate || '—'}</td>
                  <td className="py-3 pr-4 text-xs text-muted whitespace-nowrap">{new Date(i.submittedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
