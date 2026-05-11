import { MetricCard } from '@/components/MetricCard';
import { serverFetch } from '@/lib/server-fetch';

interface HomeData {
  tenants: {
    tenantId: string;
    activeCount: number;
    totalCount: number;
    mrrCents: number;
  }[];
  recentActivity: {
    tenantId: string;
    accountType: string;
    linkedAt: string;
  }[];
}

const TENANT_NAMES: Record<string, string> = {
  hunterhoney: 'HunterHoney Research',
  av: 'Atlantic & Vine',
  ebw: 'Events by Water'
};

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default async function AdminHomePage() {
  const res = await serverFetch('/api/admin/home');
  const data: HomeData = res.ok ? await res.json() : { tenants: [], recentActivity: [] };
  const totalMrr = data.tenants.reduce((sum, t) => sum + t.mrrCents, 0);
  const totalActive = data.tenants.reduce((sum, t) => sum + t.activeCount, 0);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Cross-company overview</h1>
      <p className="text-sm text-muted mb-6">Snapshot of all tenants right now.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <MetricCard label="Total MRR" value={fmtMoney(totalMrr)} hint="Across all tenants" />
        <MetricCard label="Active accounts" value={String(totalActive)} hint="status = 'active'" />
        <MetricCard
          label="Tenants live"
          value={String(data.tenants.length)}
          hint="HunterHoney shipping; AV + EBW in v2"
        />
      </div>

      <h2 className="text-lg font-medium mb-3">By tenant</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {['hunterhoney', 'av', 'ebw'].map((tid) => {
          const t = data.tenants.find((x) => x.tenantId === tid);
          return (
            <div key={tid} className="bg-surface border border-border rounded-xl p-5">
              <div className="text-xs uppercase tracking-wider text-muted">
                {TENANT_NAMES[tid]}
              </div>
              <div className="mt-2 text-xl font-semibold">
                {fmtMoney(t?.mrrCents ?? 0)}
              </div>
              <div className="text-sm text-muted mt-1">
                {(t?.activeCount ?? 0)} active / {(t?.totalCount ?? 0)} total
              </div>
            </div>
          );
        })}
      </div>

      <h2 className="text-lg font-medium mb-3">Recent activity</h2>
      <div className="bg-surface border border-border rounded-lg divide-y divide-border">
        {data.recentActivity.length === 0 && (
          <div className="px-6 py-8 text-center text-muted">No activity yet.</div>
        )}
        {data.recentActivity.map((a, i) => (
          <div key={i} className="px-4 py-3 text-sm flex items-center justify-between">
            <div>
              <span className="font-medium">{TENANT_NAMES[a.tenantId] ?? a.tenantId}</span>{' '}
              <span className="text-muted">— new {a.accountType}</span>
            </div>
            <div className="text-xs text-muted">{new Date(a.linkedAt).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
