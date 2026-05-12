export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted text-xs">—</span>;
  const v = value.toLowerCase();
  let cls = 'bg-surface-2 text-ink';
  if (['active', 'approved', 'ingested', 'converted', 'won'].includes(v)) cls = 'bg-emerald-50 text-emerald-800';
  else if (['lead', 'submitted', 'inquiry', 'pilot', 'in_review', 'pending', 'contacted', 'qualified', 'warm'].includes(v)) cls = 'bg-amber-50 text-amber-800';
  else if (['churned', 'rejected', 'failed', 'withdrawn', 'lost', 'hot'].includes(v)) cls = 'bg-rose-50 text-rose-800';
  return (
    <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${cls}`}>{value}</span>
  );
}
