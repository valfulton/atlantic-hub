'use client';

/**
 * DestinationSelect — the unified "Send pulled leads to" dropdown shared by all
 * four discovery forms (Apollo / Google Places / Instagram / website scrape).
 *
 * One selector, three kinds of destination:
 *   • Atlantic & Vine (my pipeline)  — default, leads land unassigned in AV
 *   • Assign to employee             — stamps assigned_to_user_id (rep's queue)
 *   • Send to client hub             — stamps client_id (lands in the client's hub)
 *
 * The <option> value encodes the type (`emp:<id>` / `client:<id>`); parse it with
 * parseDestination to get the body fields to POST.
 */
export interface ClientOption { clientId: number; name: string }
export interface EmployeeOption { userId: number; name: string }

/** Turn a select value into the POST fields a discovery route understands. */
export function parseDestination(value: string): { clientId?: number; assignToUserId?: number } {
  if (value.startsWith('client:')) {
    const id = Number(value.slice('client:'.length));
    return Number.isFinite(id) && id > 0 ? { clientId: id } : {};
  }
  if (value.startsWith('emp:')) {
    const id = Number(value.slice('emp:'.length));
    return Number.isFinite(id) && id > 0 ? { assignToUserId: id } : {};
  }
  return {};
}

export function DestinationSelect({
  value,
  onChange,
  clients,
  employees,
  className,
  plural = true
}: {
  value: string;
  onChange: (value: string) => void;
  clients: ClientOption[];
  employees: EmployeeOption[];
  className?: string;
  plural?: boolean;
}) {
  const noun = plural ? 'leads' : 'lead';
  return (
    <div className="pb-3 border-b border-border">
      <label className="block text-xs uppercase tracking-wider text-muted mb-1">
        Send pulled {noun} to
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className ?? 'w-full md:w-96 border border-border rounded-md px-3 py-2 text-sm'}
        style={{ backgroundColor: '#1a1f2e', color: '#f1f5f9' }}
      >
        <option value="">Atlantic &amp; Vine (my pipeline)</option>
        {employees.length > 0 && (
          <optgroup label="Assign to employee">
            {employees.map((e) => (
              <option key={`emp-${e.userId}`} value={`emp:${e.userId}`}>
                {e.name} (sales rep)
              </option>
            ))}
          </optgroup>
        )}
        {clients.length > 0 && (
          <optgroup label="Send to client hub">
            {clients.map((c) => (
              <option key={`client-${c.clientId}`} value={`client:${c.clientId}`}>
                {c.name} (their hub)
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <div className="text-[11px] text-muted mt-1">
        Default keeps {plural ? 'them' : 'it'} in your AV pipeline. Pick an employee to drop{' '}
        {plural ? 'them' : 'it'} into a rep&apos;s queue, or a client to send straight to their hub.
      </div>
    </div>
  );
}
