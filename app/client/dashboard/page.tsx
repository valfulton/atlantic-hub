/**
 * /client/dashboard
 *
 * The client's hub home. This page owns ONLY auth + the access gate; the entire
 * body is the shared <ClientDashboardBody>, fed by getClientDashboardData(). The
 * operator preview (/admin/av/clients/[id]/preview) renders the exact same body
 * from the same loader, so the two can never drift — fix once, both update.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import { getClientDashboardData } from '@/lib/client/dashboard_data';
import PortalHeader from '@/app/client/_components/PortalHeader';
import AccessPaused from '@/app/client/_components/AccessPaused';
import ClientDashboardBody from '@/app/client/_components/ClientDashboardBody';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientDashboardPage() {
  const actor = readClientActorFromHeaders(headers() as unknown as Headers);
  if (!actor) redirect('/client/login');

  const user = await findClientUserById(actor.clientUserId);
  if (!user) redirect('/client/login');

  // Self-heal: an account created before provisioning landed (client_id NULL)
  // gets its own hub on first visit, so its scoped data has somewhere to live.
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

  // Access gate: a lapsed trial or revoked account sees a calm "paused" screen.
  if (clientId) {
    const access = await getClientAccessState(clientId);
    if (!access.active) {
      return (
        <>
          <PortalHeader displayName={user.display_name} email={user.email} tier={user.tier} active="dashboard" />
          <AccessPaused expired={access.expired} />
        </>
      );
    }
  }

  const data = await getClientDashboardData({
    clientUserId: user.client_user_id,
    clientId,
    email: user.email,
    tier: user.tier,
    displayName: user.display_name
  });

  return (
    <>
      <PortalHeader displayName={user.display_name} email={user.email} tier={user.tier} active="dashboard" />
      <ClientDashboardBody data={data} email={user.email} />
    </>
  );
}
