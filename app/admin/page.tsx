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

const TENANT_TAGLINES: Record<string, string> = {
  hunterhoney: 'Education + research infrastructure',
  av: 'Brand & marketing studio',
  ebw: 'Yacht charter marketplace'
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
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-2xl font-semibold tracking-tight">Cross-company overview</h1>
        <div className="hidden sm:flex items-center gap-2 text-xs text-muted">
          <span className="live-dot" aria-hidden="true" />
          <span className="uppercase tracking-[0.12em] font-medium">All systems nominal</span>
        </div>
      </div>
      <p className="text-sm text-muted mb-8">Snapshot of all tenants right now.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        <MetricCard label="Total MRR" value={fmtMoney(totalMrr)} hint="Across all tenants" />
        <MetricCard label="Active accounts" value={String(totalActive)} hint="status = active" />
        <MetricCard
          label="Tenants live"
          value={String(data.tenants.length)}
          hint="HunterHoney shipping · AV + EBW in v2"
        />
      </div>

      <h2 className="text-sm uppercase tracking-[0.14em] text-muted font-medium mb-3">
        By tenant
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        {(['hunterhoney', 'av', 'ebw'] as const).map((tid) => {
          const t = data.tenants.find((x) => x.tenantId === tid);
          return (
            <div
              key={tid}
              data-tenant={tid}
              className="lift bg-surface border border-border rounded-xl p-5 backdrop-blur-sm cursor-default"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted font-medium">
                  {TENANT_NAMES[tid]}
                </div>
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{
                    background: 'var(--tenant-accent)',
                    boxShadow: '0 0 8px var(--tenant-glow)'
                  }}
                  aria-hidden="true"
                />
              </div>
              <div className="text-2xl font-semibold tabular-nums text-ink">
                {fmtMoney(t?.mrrCents ?? 0)}
              </div>
              <div className="text-xs text-muted mt-1 tabular-nums">
                {(t?.activeCount ?? 0)} active · {(t?.totalCount ?? 0)} total
              </div>
              <div className="text-[11px] text-muted mt-3 leading-relaxed">
                {TENANT_TAGLINES[tid]}
              </div>
            </div>
          );
        })}
      </div>

      <h2 className="text-sm uppercase tracking-[0.14em] text-muted font-medium mb-3">
        Recent activity
      </h2>
      <div className="bg-surface border border-border rounded-xl divide-y divide-[var(--border)] backdrop-blur-sm overflow-hidden">
        {data.recentActivity.length === 0 && (
          <div className="px-6 py-10 text-center">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[var(--surface-2)] mb-3">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted" aria-hidden="true">
                <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path d="M12 7v5l3 2" />
              </svg>
            </div>
            <div className="text-sm text-ink font-medium">Quiet on the wire.</div>
            <div className="text-xs text-muted mt-1">
              Once webhooks fire, new signups will stream in here in real time.
            </div>
          </div>
        )}
        {data.recentActivity.map((a, i) => (
          <div
            key={i}
            data-tenant={a.tenantId}
            className="px-5 py-3 text-sm flex items-center justify-between hover:bg-[var(--surface)] transition-colors"
          >
            <div className="flex items-center gap-3">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: 'var(--tenant-accent)' }}
                aria-hidden="true"
              />
              <span className="font-medium text-ink">
                {TENANT_NAMES[a.tenantId] ?? a.tenantId}
              </span>
              <span className="text-muted">— new {a.accountType}</span>
            </div>
            <div className="text-xs text-muted tabular-nums">
              {new Date(a.linkedAt).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
