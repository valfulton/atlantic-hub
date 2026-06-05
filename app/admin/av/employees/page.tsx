/**
 * /admin/av/employees — operator-only. Create employees (sales reps), see their
 * onboarding status, and click into each one's page (application, contract,
 * documents). Mirrors the clients list.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listEmployees } from '@/lib/employees/store';
import NewEmployeeForm from './NewEmployeeForm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUS_LABEL: Record<string, string> = {
  invited: 'Invited — hasn’t set password yet',
  applied: 'Application submitted',
  active: 'Active',
  inactive: 'Inactive'
};

export default async function EmployeesPage() {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

  let employees: Awaited<ReturnType<typeof listEmployees>> = [];
  try {
    employees = await listEmployees();
  } catch {
    /* table may not exist until migration 052 runs — show empty state */
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold mb-1">Employees</h1>
      <p className="text-sm text-muted mb-5">Your sales reps and team. Create an account, send the invite, then they complete their application and contract.</p>

      <NewEmployeeForm />

      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-3">Team</div>
        {/* (#302) Whole-row link so val doesn't have to find the underlined
            name. Includes a visible → arrow on hover so it reads as "click
            to open." val hit this on Rebecca: the row looked like a static
            info card, the resend button lives on the detail page. */}
        {employees.length === 0 ? (
          <p className="text-sm text-muted">No employees yet. Add one above. (If you just deployed, run migration 052 first.)</p>
        ) : (
          <ul className="divide-y divide-border">
            {employees.map((e) => (
              <li key={e.user_id}>
                <Link
                  href={`/admin/av/employees/${e.user_id}`}
                  className="group py-2.5 px-2 -mx-2 rounded-lg flex items-center justify-between gap-3 hover:bg-[var(--gold-bright)]/[0.04] transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink group-hover:text-[color-mix(in_srgb,var(--gold-bright)_95%,transparent)] transition-colors flex items-center gap-1.5">
                      {e.display_name || e.email}
                      <span aria-hidden="true" className="text-muted/60 group-hover:text-[var(--gold-bright)] transition-colors">
                        →
                      </span>
                    </div>
                    <div className="text-[11px] text-muted">
                      {e.email}{e.title ? ` · ${e.title}` : ''}
                    </div>
                  </div>
                  <span className="text-[11px] text-muted shrink-0">{STATUS_LABEL[e.status ?? 'invited'] ?? e.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
