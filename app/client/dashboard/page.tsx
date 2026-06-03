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
import WelcomePopover from '@/app/client/_components/WelcomePopover';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import { getClientDashboardData } from '@/lib/client/dashboard_data';
import PortalHeader from '@/app/client/_components/PortalHeader';
import AccessPaused from '@/app/client/_components/AccessPaused';
import ClientDashboardBody from '@/app/client/_components/ClientDashboardBody';
// (#394) V3 social skin top section.
import SocialDashboardBody from './SocialDashboardBody';
import { watchlistForClient } from '@/lib/public_intel/distress_engine';
import { buildSignalCardData } from '@/lib/public_intel/signal_voice';
import { listBrandsForUser } from '@/lib/client/membership';

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

  // (#394) V3 social skin — prepend the dashboard with a luxury social-feed
  // preview of the distress watchlist + brand switcher. Adriana opens to ONE
  // featured signal + her cards. The classic dashboard body (brief/team/plan/
  // campaign) still renders below for continuity.
  let social: React.ComponentProps<typeof SocialDashboardBody> | null = null;
  if (clientId) {
    try {
      const [rows, brandsForUser] = await Promise.all([
        watchlistForClient(clientId, 9),
        listBrandsForUser(actor.clientUserId)
      ]);
      const brands = brandsForUser.map((b) => ({
        id: String(b.clientId),
        label: b.clientName || `Brand ${b.clientId}`,
        monogram: (b.clientName || '?').charAt(0).toUpperCase()
      }));
      if (rows.length > 0 || brands.length > 1) {
        const top = rows[0];
        const featured = top
          ? (() => {
              const v = buildSignalCardData({
                entityLabel: top.entityLabel || 'A flagged entity',
                contributingSignals: top.contributingSignals,
                score: top.score
              });
              return {
                entity: `${top.entityLabel || 'A flagged entity'} · flagged on your watchlist`,
                headline: v.headline,
                trail: v.trail
              };
            })()
          : null;
        const cards = rows.slice(1).map((r) => {
          const v = buildSignalCardData({
            entityLabel: r.entityLabel || 'A flagged entity',
            contributingSignals: r.contributingSignals,
            score: r.score
          });
          return {
            entityKey: r.entityKey,
            entity: r.entityLabel || 'A flagged entity',
            monogram: (r.entityLabel || '?').charAt(0).toUpperCase(),
            chip: r.score >= 50 ? `Score ${r.score} · hot` : `Score ${r.score}`,
            chipKind: 'signal' as const,
            headline: v.headline,
            trail: v.trail
          };
        });
        social = {
          firstName: data.firstName,
          brands,
          activeBrandId: String(clientId),
          featured,
          cards
        };
      }
    } catch {
      /* non-fatal — fall through without the social section */
    }
  }

  return (
    <>
      <PortalHeader displayName={user.display_name} email={user.email} tier={user.tier} active="dashboard" />
      {/* (#189) First-login welcome card-flip popovers. Self-dismisses on
          tour-complete, persists in localStorage so it shows once per
          identity. Operator preview never renders it (renders directly
          inside ClientDashboardBody only on the live page). */}
      <WelcomePopover
        clientUserId={user.client_user_id}
        firstName={data.firstName}
        brandName={user.display_name || data.firstName || 'your business'}
        tier={user.tier}
      />
      {/* (#394) V3 social skin — luxury social-feed preview ABOVE the classic
          dashboard body. Hidden when watchlist is empty AND single-brand. */}
      {social && <SocialDashboardBody {...social} />}
      <ClientDashboardBody data={data} email={user.email} />
    </>
  );
}
