/**
 * /client/leads/[audit_id]
 *
 * A client's view of ONE of their leads. Strictly scoped: getClientLeadDetail
 * only returns the lead if it belongs to this client's account, else 404. This
 * is the curated client mirror of the operator lead-detail page — the operator
 * machinery (model/version, sourcing, the self-reported Challenge tab) is left
 * out; clients see the audit, the score, and what to say on the call.
 *
 * Increment 1 (read): Audit, AI Scoring (no model), Identity, Commercials soon.
 * Increment 2 will add front-and-center call logging + notes + outreach.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import { getClientLeadDetail } from '@/lib/client/lead_detail';
import PortalHeader from '@/app/client/_components/PortalHeader';
import AccessPaused from '@/app/client/_components/AccessPaused';
import ClientLeadDetailTabs from './ClientLeadDetailTabs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientLeadDetailPage({ params }: { params: { audit_id: string } }) {
  const actor = readClientActorFromHeaders(headers() as unknown as Headers);
  if (!actor) redirect('/client/login');

  const user = await findClientUserById(actor.clientUserId);
  if (!user) redirect('/client/login');

  if (!user.client_id) {
    try {
      const cid = await ensureClientHub(user);
      if (cid) user.client_id = cid;
    } catch {
      /* non-fatal */
    }
  }

  // Multi-brand (#101): scope to the brand the owner is currently viewing.
  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);

  if (clientId) {
    const access = await getClientAccessState(clientId);
    if (!access.active) {
      return (
        <>
          <PortalHeader displayName={user.display_name} email={user.email} tier={user.tier} active="leads" />
          <AccessPaused expired={access.expired} />
        </>
      );
    }
  }

  const lead = await getClientLeadDetail(clientId, params.audit_id);
  if (!lead) notFound();

  return (
    <>
      <PortalHeader displayName={user.display_name} email={user.email} tier={user.tier} active="leads" />
      <main className="max-w-4xl mx-auto px-4 py-8 sm:py-10">
        <a href="/client/leads" className="inline-flex items-center gap-1 text-sm text-brand hover:underline mb-5">
          &larr; Back to your leads
        </a>
        <ClientLeadDetailTabs lead={lead} />
        <footer className="border-t border-border mt-12 pt-5 text-xs text-muted text-center">
          &copy; {new Date().getFullYear()} Atlantic And Vine LLC. Signed in as{' '}
          <span className="text-ink">{user.email}</span>.
        </footer>
      </main>
    </>
  );
}
