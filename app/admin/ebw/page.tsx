import Link from 'next/link';
import { MetricCard } from '@/components/MetricCard';
import { serverFetch } from '@/lib/server-fetch';

interface Stats {
  inquiries: number;
  bookingsTotal: number;
  bookingsThisMonth: number;
  revenueThisMonth: number;
  revenueYtd: number;
  partners: { vessels: number; captains: number };
  investors: number;
  recentActivity: Array<{
    activityId: number;
    occurredOn: string;
    activityType: string;
    prospectLabel: string | null;
    outcome: string | null;
  }>;
}

function fmtUSD(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export default async function EbwPage() {
  const res = await serverFetch('/api/admin/ebw/stats');
  const { stats }: { stats: Stats } = res.ok
    ? await res.json()
    : {
        stats: {
          inquiries: 0,
          bookingsTotal: 0,
          bookingsThisMonth: 0,
          revenueThisMonth: 0,
          revenueYtd: 0,
          partners: { vessels: 0, captains: 0 },
          investors: 0,
          recentActivity: []
        }
      };

  const tiles = [
    { href: '/admin/ebw/inquiries', title: 'Charter inquiries', desc: 'Customer requests from the EBW website.', count: stats.inquiries },
    { href: '/admin/ebw/bookings', title: 'Bookings', desc: 'Closed bookings + commission tracking.', count: stats.bookingsTotal },
    { href: '/admin/ebw/revenue', title: 'Revenue', desc: 'YTD revenue by stream.', count: undefined },
    { href: '/admin/ebw/partners', title: 'Vessel + captain partners', desc: 'Active boat owner and captain applications.', count: stats.partners.vessels + stats.partners.captains },
    { href: '/admin/ebw/investors', title: 'Investors', desc: 'NDA-signed investor registrations.', count: stats.investors },
    { href: '/admin/ebw/activity', title: 'Marketing activity', desc: 'Calls, emails, meetings logged.', count: stats.recentActivity.length }
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Events by Water</h1>
      <p className="text-sm text-muted mb-6">Charter marketplace · 22% commission · operator view</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Inquiries" value={String(stats.inquiries)} hint="charter_inquiries form" />
        <MetricCard label="Bookings this month" value={String(stats.bookingsThisMonth)} hint={`${stats.bookingsTotal} total`} />
        <MetricCard label="Revenue this month" value={fmtUSD(stats.revenueThisMonth)} hint={`${fmtUSD(stats.revenueYtd)} YTD`} />
        <MetricCard label="Partners" value={String(stats.partners.vessels + stats.partners.captains)} hint={`${stats.partners.vessels} vessels · ${stats.partners.captains} captains`} />
      </div>

      <h2 className="text-sm font-medium text-muted mb-3">Sections</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="block bg-surface border border-border rounded-xl p-5 hover:border-ink">
            <div className="flex items-baseline justify-between">
              <div className="text-lg font-semibold">{t.title}</div>
              {typeof t.count === 'number' && <div className="text-sm text-muted">{t.count}</div>}
            </div>
            <div className="text-sm text-muted mt-1">{t.desc}</div>
          </Link>
        ))}
      </div>

      {stats.recentActivity.length > 0 && (
        <>
          <h2 className="text-sm font-medium text-muted mb-3">Recent marketing activity</h2>
          <ul className="space-y-2">
            {stats.recentActivity.map((a) => (
              <li key={a.activityId} className="bg-surface border border-border rounded-lg px-4 py-3 text-sm flex items-center justify-between">
                <div>
                  <span className="font-medium">{a.activityType.replace(/_/g, ' ')}</span>
                  {a.prospectLabel && <span className="text-muted"> · {a.prospectLabel}</span>}
                  {a.outcome && <span className="text-muted"> · {a.outcome.replace(/_/g, ' ')}</span>}
                </div>
                <div className="text-xs text-muted">{new Date(a.occurredOn).toLocaleDateString()}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
