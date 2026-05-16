import { DiscoverForm } from './DiscoverForm';

export default function DiscoverPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Discover leads</h1>
      <p className="text-sm text-muted mb-6">
        Search Apollo&apos;s database of 275M+ contacts by ICP filters. Matching people are
        inserted into <code className="bg-surface px-1 rounded">shhdbite_AV.leads</code> as
        net-new prospects. Hunter enrichment runs automatically on the next cron pass to fill in
        emails.
      </p>
      <DiscoverForm />
    </div>
  );
}
