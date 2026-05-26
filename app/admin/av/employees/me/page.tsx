/**
 * /admin/av/employees/me — the logged-in employee fills out their OWN
 * application. Reads the admin user id the middleware injects (x-ah-user-id),
 * loads their profile, and renders the application form in self mode.
 */
import { headers } from 'next/headers';
import { getEmployee, getEmployeeApplication, listEmployeeDocuments } from '@/lib/employees/store';
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
        <h1 className="text-2xl font-semibold mb-2">Your application</h1>
        <p className="text-sm text-muted">This page is for employee accounts. If you’re an operator, manage employees under Employees in the sidebar.</p>
      </main>
    );
  }

  const application = await getEmployeeApplication(userId).catch(() => null);
  const docs = (await listEmployeeDocuments(userId).catch(() => [])).map((d) => ({
    doc_id: d.doc_id, label: d.label, content_type: d.content_type,
    created_at: new Date(d.created_at).toISOString()
  }));

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold mb-1">Welcome, {emp.display_name || emp.email}.</h1>
      <p className="text-sm text-muted mb-5">Complete your onboarding details below. You can come back and update them any time.</p>
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
  );
}
