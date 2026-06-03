/**
 * /client/leads/[audit_id]  (#401, val 2026-06-03, per VR V3 leads spec)
 *
 * V3 shell — monogram top bar, Cormorant company name + score eyebrow,
 * back-to-pipeline breadcrumb, ClientLeadDetailTabs body unchanged
 * (interactive — VR will restyle tabs in a later pass). No PortalHeader,
 * no WaveDivider.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import { getClientLeadDetail } from '@/lib/client/lead_detail';
import AccessPaused from '@/app/client/_components/AccessPaused';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';
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
    } catch { /* non-fatal */ }
  }

  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);

  if (clientId) {
    const access = await getClientAccessState(clientId);
    if (!access.active) {
      return <AccessPaused expired={access.expired} />;
    }
  }

  const lead = await getClientLeadDetail(clientId, params.audit_id);
  if (!lead) notFound();

  return (
    <main className="v3-wrap" style={{ maxWidth: 980 }}>
      <ClientV3TopNav />

      <section className="v3-greet">
        <a href="/client/leads" className="v3-link" style={{ display: 'inline-block', marginBottom: '14px' }}>
          ← Pipeline
        </a>
        <p className="v3-eyebrow">
          {lead.score !== null ? `Score ${Math.round(lead.score)}` : 'Lead'}
          {lead.band ? ` · ${lead.band[0].toUpperCase()}${lead.band.slice(1)}` : ''}
        </p>
        <h1 className="v3-h1">{lead.company}</h1>
        {lead.industry && (
          <p className="v3-lede" style={{ marginTop: '4px' }}>
            {lead.industry}
          </p>
        )}
      </section>

      <div style={{ marginTop: '8px' }}>
        <ClientLeadDetailTabs lead={lead} />
      </div>

      <p className="v3-foot">Signed in as {user.email}</p>
    </main>
  );
}
