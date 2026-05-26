import Link from 'next/link';
import { DiscoverForm } from './DiscoverForm';
import { PlacesDiscoverForm } from './PlacesDiscoverForm';
import { InstagramDiscoverForm } from './InstagramDiscoverForm';
import { ScrapeDiscoverForm } from './ScrapeDiscoverForm';
import { listClientAccounts } from '@/lib/av/clients_overview';

export const dynamic = 'force-dynamic';

/**
 * Unified discovery page. URL-driven tab selection (?source=apollo|places|
 * instagram|scrape) so the active tab is shareable and refresh-safe.
 *
 * All four sources route through the same dedup-by-domain + target_business
 * heuristic so leads land in one consistent table at /admin/av regardless
 * of which source produced them.
 */

type Source = 'apollo' | 'places' | 'instagram' | 'scrape';

const TABS: Array<{ id: Source; label: string; subtitle: string }> = [
  { id: 'apollo', label: 'Apollo', subtitle: 'B2B contacts by ICP filters' },
  { id: 'places', label: 'Google Places', subtitle: 'Hospitality & local businesses' },
  { id: 'instagram', label: 'Instagram', subtitle: 'IG handles → leads (via Apify)' },
  { id: 'scrape', label: 'Website scrape', subtitle: 'Paste a URL, pull contact info' }
];

export default async function DiscoverPage({
  searchParams
}: {
  searchParams?: { source?: string };
}) {
  const sourceRaw = searchParams?.source ?? '';
  const source: Source = (TABS.find((t) => t.id === sourceRaw)?.id ?? 'apollo') as Source;

  // Clients for the "send pulled leads to" destination dropdown.
  const clients = (await listClientAccounts().catch(() => [])).map((c) => ({
    clientId: c.clientId,
    name: c.name
  }));

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Find new leads</h1>
      <p className="text-sm text-muted mb-5">
        Pulls <strong>brand-new leads</strong> into your pipeline (this is not Enrich — Enrich only
        fills contact details on leads you already have). Four sources, one leads table. All
        discoveries dedup by domain across sources and auto-tag{' '}
        <code className="bg-surface px-1 rounded">target_business</code> (AV / EBW / Both) by
        industry. Leads land at{' '}
        <Link href="/admin/av" className="text-brand hover:underline">
          /admin/av
        </Link>
        .
      </p>

      <div className="flex flex-wrap gap-1 mb-6 border-b border-border">
        {TABS.map((tab) => {
          const active = tab.id === source;
          return (
            <Link
              key={tab.id}
              href={`/admin/av/discover?source=${tab.id}`}
              className={`px-4 py-2 -mb-px border-b-2 transition-colors ${
                active
                  ? 'border-brand text-ink'
                  : 'border-transparent text-muted hover:text-ink hover:border-border'
              }`}
            >
              <div className="text-sm font-medium">{tab.label}</div>
              <div className="text-[10px] text-muted/80 uppercase tracking-wider">{tab.subtitle}</div>
            </Link>
          );
        })}
      </div>

      {source === 'apollo' && (
        <div>
          <p className="text-sm text-muted mb-4">
            Apollo organizations/search → top-people lookup → inserts as leads. Strong for
            B2B/agency targets; weak coverage for USVI hospitality (use Places or IG for those).
          </p>
          <DiscoverForm clients={clients} />
        </div>
      )}

      {source === 'places' && <PlacesDiscoverForm clients={clients} />}
      {source === 'instagram' && <InstagramDiscoverForm clients={clients} />}
      {source === 'scrape' && <ScrapeDiscoverForm clients={clients} />}
    </div>
  );
}
