/**
 * /admin/av/employees/[user_id] — operator-only employee record. Shows account +
 * onboarding status. Application form, contract signing, and document uploads
 * attach here (next phases).
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getEmployee, getEmployeeApplication, listEmployeeDocuments } from '@/lib/employees/store';
import EmployeeApplicationForm from '../EmployeeApplicationForm';
import EmployeeDocsPanel from '../EmployeeDocsPanel';
import ResendInviteButton from './ResendInviteButton';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function fmt(d: Date | null): string {
  if (!d) return '—';
  try { return new Date(d).toISOString().slice(0, 10); } catch { return '—'; }
}

export default async function EmployeeDetailPage({ params }: { params: { user_id: string } }) {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role === 'client_user') redirect('/admin');

  const userId = Number.parseInt(params.user_id, 10);
  if (!Number.isFinite(userId) || userId <= 0) notFound();

  const emp = await getEmployee(userId);
  if (!emp) notFound();

  const application = await getEmployeeApplication(userId).catch(() => null);
  const docs = (await listEmployeeDocuments(userId).catch(() => [])).map((d) => ({
    doc_id: d.doc_id, label: d.label, content_type: d.content_type,
    created_at: new Date(d.created_at).toISOString()
  }));

  return (
    <div className="max-w-3xl">
      <div className="text-sm text-muted mb-4">
        <Link href="/admin/av/employees" className="hover:text-ink transition-colors">Employees</Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink">{emp.display_name || emp.email}</span>
      </div>

      <h1 className="text-2xl font-semibold">{emp.display_name || emp.email}</h1>
      <p className="text-sm text-muted mt-1">{emp.email}{emp.title ? ` · ${emp.title}` : ''}</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-6">
        {[
          { label: 'Status', value: emp.status ?? 'invited' },
          { label: 'Application', value: emp.application_completed_at ? fmt(emp.application_completed_at) : 'Not yet' },
          { label: 'Contract', value: emp.contract_signed_at ? `Signed ${fmt(emp.contract_signed_at)}` : 'Not signed' }
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-surface p-4">
            <div className="text-sm font-semibold text-ink capitalize">{s.value}</div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* (#301) Onboarding card — shown for any pre-active state so val can
          resend the invite if Rebecca / Koby / etc never received the original
          link, or if the 14-day token expired. The card stays visible until
          the employee has set their password (status flips to 'active'). */}
      {emp.status !== 'active' && (
        <div className="rounded-2xl border border-border bg-surface p-4 mt-5">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-2">Onboarding</div>
          <p className="text-sm text-muted leading-relaxed mb-3">
            {emp.status === 'invited'
              ? 'Invited but hasn’t set their password yet. If they never received the original link or it’s expired, resend below.'
              : `Status: ${emp.status ?? 'unknown'}. They still need to set a password before they can log in. Resend the invite link below.`}
          </p>
          <ResendInviteButton userId={emp.user_id} />
        </div>
      )}

      <div className="mt-5">
        <EmployeeApplicationForm userId={emp.user_id} initial={application} />
      </div>

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
