export function MetricCard({
  label,
  value,
  hint
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="lift bg-surface border border-border rounded-xl p-5 backdrop-blur-sm">
      <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted font-medium">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold metric-value leading-none">
        {value}
      </div>
      {hint && <div className="text-xs text-muted mt-2">{hint}</div>}
    </div>
  );
}
