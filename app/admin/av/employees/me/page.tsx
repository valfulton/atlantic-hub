/**
 * /admin/av/employees/me — the logged-in employee's home.
 *
 * Leads with the gamified sales-rep cockpit (their pipeline across A&V + EBW,
 * pipeline $, weekly activity, streak, team leaderboard). Their onboarding
 * (application + contract + documents) lives in a collapsible section below so
 * a brand-new rep can still complete it, while active reps see their book first.
 *
 * Reads the admin user id the middleware injects (x-ah-user-id).
 */
import { headers } from 'next/headers';
import { getEmployee, getEmployeeApplication, listEmployeeDocuments } from '@/lib/employees/store';
import { getRepDashboard } from '@/lib/sales/rep_dashboard';
import RepCockpit from '../RepCockpit';
import EmployeeApplicationForm from '../EmployeeApplicationForm';
import EmployeeDocsPanel from '../EmployeeDocsPanel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function MyApplicationPage() {
  const h = headers();
  const userId = Number.parseInt(h.get('x-ah-user-id') ?? '', 10);

  const emp = Number.isFinite(userId) && userId > 0 ? await getEmployee(userId).catch(() => null) : null;

  if (!emp) {
    return (
      <main className="max-w-2xl">
        <h1 className="text-2xl font-semibold mb-2">Your dashboard</h1>
        <p className="text-sm text-muted">This page is for employee accounts. If you’re an operator, manage employees under Employees in the sidebar.</p>
      </main>
    );
  }

  const [application, docsRaw, dashboard] = await Promise.all([
    getEmployeeApplication(userId).catch(() => null),
    listEmployeeDocuments(userId).catch(() => []),
    getRepDashboard(userId).catch(() => null)
  ]);
  const docs = docsRaw.map((d) => ({
    doc_id: d.doc_id, label: d.label, content_type: d.content_type,
    created_at: new Date(d.created_at).toISOString()
  }));

  // A rep who hasn't set a password / finished onboarding gets onboarding open.
  const onboardingIncomplete = (emp.status ?? 'invited') === 'invited' || !emp.contract_signed_name;

  return (
    <div className="max-w-3xl">
      {dashboard ? (
        <RepCockpit data={dashboard} repName={emp.display_name || emp.email} />
      ) : (
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h1 className="text-2xl font-semibold text-ink">Welcome, {emp.display_name || emp.email}.</h1>
          <p className="text-sm text-muted mt-1">Your sales cockpit will appear here once your account is fully set up.</p>
        </div>
      )}

      <details className="mt-6 rounded-2xl border border-border bg-surface" open={onboardingIncomplete}>
        <summary className="cursor-pointer select-none px-5 py-4 text-sm font-medium text-ink">
          Your onboarding &amp; paperwork
          {onboardingIncomplete && (
            <span className="ml-2 text-[11px] uppercase tracking-[0.12em] text-[#EBCB6B]">Action needed</span>
          )}
        </summary>
        <div className="px-5 pb-5 pt-1">
          <p className="text-sm text-muted mb-4">Complete your onboarding details below. You can come back and update them any time.</p>
          <EmployeeApplicationForm userId={emp.user_id} initial={application} selfMode />
          <div className="mt-5">
            <EmployeeDocsPanel
              userId={emp.user_id}
              documents={docs}
              contractSignedName={emp.contract_signed_name}
              contractSignedAt={emp.contract_signed_at ? new Date(emp.contract_signed_at).toISOString() : null}
            />
          </div>
        </div>
      </details>
    </div>
  );
}
