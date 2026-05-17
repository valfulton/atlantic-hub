import { CsvImportForm } from './CsvImportForm';

/**
 * /admin/av/import — Upload a CSV of leads/customers and bulk-import them
 * into the AV pipeline with dedup, target_business inference, and the same
 * activity tracking as Apollo/Places/IG discoveries.
 *
 * Client onboarding flow: the client (or operator on their behalf) drops
 * their existing customer/lead list here, the platform absorbs it, and
 * everything from that point forward is unified with future discoveries.
 */
export default function ImportPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Import leads from CSV</h1>
      <p className="text-sm text-muted mb-6">
        Upload an existing customer list, lead list, or contact export. Each row becomes a lead in
        the pipeline with cross-source dedup, automatic target-business tagging, and full activity
        history. Apollo / Google Places / Instagram discoveries already in your DB will be matched
        and merged, not duplicated.
      </p>
      <CsvImportForm />
    </div>
  );
}
