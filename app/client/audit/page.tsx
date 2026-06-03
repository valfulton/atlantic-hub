/**
 * /client/audit
 *
 * Full-page view of the client's Strategic Marketing Audit. Server-rendered.
 * Print-friendly (uses standard prose rendering, no client JS).
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { getClientOwnAudit } from '@/lib/client/dashboard_data';
import PortalHeader from '@/app/client/_components/PortalHeader';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientAuditPage() {
  const actor = readClientActorFromHeaders(headers() as unknown as Headers);
  if (!actor) redirect('/client/login');

  const user = await findClientUserById(actor.clientUserId);
  if (!user) redirect('/client/login');

  // Shared loader — the client's own audit, matched by email (one source of truth).
  const audit = await getClientOwnAudit(user.email);

  return (
    <>
      <PortalHeader
        displayName={user.display_name}
        email={user.email}
        tier={user.tier}
        active="audit"
      />

      <main className="w-full max-w-3xl mx-auto px-3 sm:px-4 py-6 sm:py-10">
        <a
          href="/client/dashboard"
          className="text-sm text-muted hover:text-ink inline-block mb-4"
        >
          &lt;- Back to dashboard
        </a>

        <div className="mb-6">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
            Strategic Marketing Audit
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-ink mt-1">
            {audit?.company || user.display_name || 'Your business audit'}
          </h1>
          {audit && (
            <div className="mt-2 text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
              {audit.industry && <span>Industry: <span className="text-ink">{audit.industry}</span></span>}
              <span>
                Generated:{' '}
                <span className="text-ink">
                  {(audit.audit_generated ?? audit.created_at)
                    ?.toISOString()
                    .slice(0, 10) || 'Recently'}
                </span>
              </span>
            </div>
          )}
        </div>

        {audit ? (
          <article className="rounded-2xl border border-border bg-surface p-6 sm:p-8 text-ink leading-relaxed whitespace-pre-line text-[15px]">
            {audit.audit_content}
          </article>
        ) : (
          <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
            Your audit hasn&apos;t been generated yet. Check back soon, or reply
            to your intake confirmation email if it&apos;s been more than 48
            hours.
          </div>
        )}

        <div className="mt-8 text-xs text-muted">
          This audit is for your eyes only. Don&apos;t share publicly.
        </div>
      </main>
    </>
  );
}
