import { serverFetch } from '@/lib/server-fetch';

interface Vessel {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  vesselName: string | null;
  vesselType: string | null;
  markets: string | null;
  submittedAt: string;
}
interface Captain {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  location: string;
  licenseType: string | null;
  experienceBio: string | null;
  markets: string | null;
  submittedAt: string;
}

export default async function EbwPartnersPage() {
  const res = await serverFetch('/api/admin/ebw/partners');
  const { vessels, captains }: { vessels: Vessel[]; captains: Captain[] } = res.ok ? await res.json() : { vessels: [], captains: [] };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Vessel + captain partners</h1>
      <p className="text-sm text-muted mb-6">From list-vessel.html and captain-apply.html · read-only.</p>

      <h2 className="text-sm font-medium text-muted mb-3">Vessel listings ({vessels.length})</h2>
      {vessels.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-muted bg-surface border border-border rounded-lg mb-8">
          No vessel listings yet.
        </div>
      ) : (
        <div className="overflow-x-auto mb-8">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-4">Owner</th>
                <th className="py-2 pr-4">Contact</th>
                <th className="py-2 pr-4">Vessel</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Markets</th>
                <th className="py-2 pr-4">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {vessels.map((v) => (
                <tr key={v.id} className="border-b border-border align-top">
                  <td className="py-3 pr-4 font-medium">{v.name || '—'}</td>
                  <td className="py-3 pr-4 text-xs">
                    {v.email && <div>{v.email}</div>}
                    {v.phone && <div className="text-muted">{v.phone}</div>}
                  </td>
                  <td className="py-3 pr-4">{v.vesselName || '—'}</td>
                  <td className="py-3 pr-4">{v.vesselType || '—'}</td>
                  <td className="py-3 pr-4 text-xs">{v.markets || '—'}</td>
                  <td className="py-3 pr-4 text-xs text-muted whitespace-nowrap">{new Date(v.submittedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="text-sm font-medium text-muted mb-3">Captain applications ({captains.length})</h2>
      {captains.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-muted bg-surface border border-border rounded-lg">
          No captain applications yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Contact</th>
                <th className="py-2 pr-4">Location</th>
                <th className="py-2 pr-4">License</th>
                <th className="py-2 pr-4">Experience</th>
                <th className="py-2 pr-4">Markets</th>
                <th className="py-2 pr-4">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {captains.map((c) => (
                <tr key={c.id} className="border-b border-border align-top">
                  <td className="py-3 pr-4 font-medium">{c.name || '—'}</td>
                  <td className="py-3 pr-4 text-xs">
                    {c.email && <div>{c.email}</div>}
                    {c.phone && <div className="text-muted">{c.phone}</div>}
                  </td>
                  <td className="py-3 pr-4 text-xs">{c.location || '—'}</td>
                  <td className="py-3 pr-4">{c.licenseType || '—'}</td>
                  <td className="py-3 pr-4 text-xs max-w-md">{c.experienceBio || '—'}</td>
                  <td className="py-3 pr-4 text-xs">{c.markets || '—'}</td>
                  <td className="py-3 pr-4 text-xs text-muted whitespace-nowrap">{new Date(c.submittedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
