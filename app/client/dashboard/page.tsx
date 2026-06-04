/**
 * /client/dashboard  (#397, val 2026-06-03)
 *
 * V3 — luxury Cormorant register from demo_client_portal_v3.html.
 *
 * This page is now THIN: it handles auth + the access gate, calls the
 * shared `loadDashboardV3` loader, and renders <ClientDashboardV3>. The
 * preview-as-client mirror at /admin/av/clients/[id]/preview calls the
 * SAME loader and renders the SAME body — they cannot drift.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import WelcomePopover from '@/app/client/_components/WelcomePopover';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import { getClientDashboardData } from '@/lib/client/dashboard_data';
import AccessPaused from '@/app/client/_components/AccessPaused';
import { loadDashboardV3 } from '@/lib/client/dashboard_v3_loader';
import { getWelcomePopupSlides } from '@/lib/welcome/copy';
import ClientDashboardV3 from './ClientDashboardV3';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientDashboardPage() {
  const actor = readClientActorFromHeaders(headers() as unknown as Headers);
  if (!actor) redirect('/client/login');

  const user = await findClientUserById(actor.clientUserId);
  if (!user) redirect('/client/login');

  // Self-heal for legacy accounts created pre-provisioning.
  if (!user.client_id) {
    try {
      const cid = await ensureClientHub(user);
      if (cid) user.client_id = cid;
    } catch { /* non-fatal */ }
  }

  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);

  // Access gate — lapsed/revoked accounts see the calm "paused" screen.
  if (clientId) {
    const access = await getClientAccessState(clientId);
    if (!access.active) {
      return <AccessPaused expired={access.expired} />;
    }
  }

  const data = await getClientDashboardData({
    clientUserId: user.client_user_id,
    clientId,
    email: user.email,
    tier: user.tier,
    displayName: user.display_name
  });

  // Shared loader — preview/page.tsx calls this same function.
  const v3 = await loadDashboardV3({
    clientId,
    clientUserId: actor.clientUserId,
    data
  });

  // (#408) Pull editor-managed slide copy. Falls back to baked-in defaults.
  const welcomeSlides = await getWelcomePopupSlides();

  return (
    <>
      <WelcomePopover
        clientUserId={user.client_user_id}
        firstName={data.firstName}
        brandName={user.display_name || data.firstName || 'your business'}
        tier={user.tier}
        slides={welcomeSlides}
      />
      <ClientDashboardV3 {...v3} />
    </>
  );
}
