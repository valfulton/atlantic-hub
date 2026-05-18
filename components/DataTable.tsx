'use client';

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
}

export function DataTable<T extends object>({
  columns,
  rows,
  emptyMessage = 'No records yet.',
  rowClassName
}: {
  columns: Column<T>[];
  rows: T[];
  emptyMessage?: string;
  /** Optional per-row className. Receives row + index, returns a class string appended to the <tr>. Used for highlight effects like live-mode "just arrived" fades. */
  rowClassName?: (row: T, index: number) => string;
}) {
  if (rows.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-muted bg-surface border border-border rounded-lg">
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-lg overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="px-4 py-3 text-left font-medium">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const extra = rowClassName ? rowClassName(row, idx) : '';
            return (
              <tr key={idx} className={`border-t border-border ${extra}`.trim()}>
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-3 align-top">
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
