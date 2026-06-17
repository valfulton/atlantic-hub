/**
 * /client/dashboard
 *
 * Mobile-app dashboard mirroring client_view_social_mock.html exactly:
 * sticky cream top bar, Fraunces greeting, brand switcher Stories,
 * Featured Signal hero (cascade-attributed), watchlist + fresh-leads
 * SignalCard grids, bottom tab bar (from layout).
 *
 * Auth + access gate kept from prior page. Body component is
 * ClientDashboard (this page is thin — orchestration only).
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
import { loadClientDashboard } from '@/lib/client/client_dashboard_loader';
import { getWelcomePopupSlides, getWelcomeSlidesForEngagement } from '@/lib/welcome/copy';
import ClientDashboard from './ClientDashboard';
// (val 2026-06-17, #699) Nav now lives INSIDE ClientDashboard's app-top
// header so it travels everywhere the component is rendered — including the
// operator preview at /admin/av/clients/[id]/preview/page.tsx, which is the
// other dashboard surface val cares about. Wrapping the page in
// ClientV3TopNav only would have left preview without nav.

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

  const props = await loadClientDashboard({
    clientUserId: actor.clientUserId,
    activeClientId: clientId,
    firstName: data.firstName || 'there',
    brandName: 'Atlantic & Vine',
    brandPill: 'Client'
  });

  // (#408/#551) Welcome slides. lead_gen keeps the legacy /admin/av/popups
  // popover (unchanged). Non-lead_gen engagements get kind-specific slides
  // whose titles are editable per client at /admin/av/copy.
  const welcomeSlides = props.engagementKind === 'lead_gen'
    ? await getWelcomePopupSlides()
    : await getWelcomeSlidesForEngagement({ clientId, kind: props.engagementKind });

  return (
    <>
      <WelcomePopover
        clientUserId={user.client_user_id}
        firstName={data.firstName}
        brandName={user.display_name || data.firstName || 'your business'}
        tier={user.tier}
        slides={welcomeSlides}
      />
      <ClientDashboard {...props} />
    </>
  );
}
