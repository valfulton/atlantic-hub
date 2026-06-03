/**
 * /client/dashboard  (#396, val 2026-06-03)
 *
 * V3 — the luxury Cormorant register pulled directly from
 * demo_client_portal_v3.html. NOT a retrofit of the old dashboard body.
 * Monogram + brand chips → Cormorant greeting → ONE hero card → "In
 * motion" quiet cards → QUIET · LEGIBLE · VERIFIABLE footer.
 *
 * The classic ClientDashboardBody (guidance feed, creative brief, team,
 * plan) is intentionally NOT rendered here — its content moves into the
 * "in motion" cards (one quiet line per item) or to dedicated pages.
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
import { watchlistForClient } from '@/lib/public_intel/distress_engine';
import { buildSignalCardData } from '@/lib/public_intel/signal_voice';
import { listBrandsForUser } from '@/lib/client/membership';
import ClientDashboardV3, { type ClientDashboardV3Props, type DashboardCardData } from './ClientDashboardV3';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function weekLabelNow(): string {
  const d = new Date();
  const day = d.getDate();
  const month = d.toLocaleString('en', { month: 'long' });
  return `Your channel · week of ${day} ${month}`;
}

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

  // Build hero + motion cards from real data.
  let heroProps: ClientDashboardV3Props['hero'] = null;
  const motion: DashboardCardData[] = [];

  if (clientId) {
    try {
      const rows = await watchlistForClient(clientId, 4);
      const top = rows[0];
      if (top) {
        const v = buildSignalCardData({
          entityLabel: top.entityLabel || 'A flagged entity',
          contributingSignals: top.contributingSignals,
          score: top.score
        });
        heroProps = {
          label: "This week's strongest signal",
          title: v.headline,
          body: `${top.entityLabel || 'A flagged entity'} surfaced on your watchlist with a score of ${top.score}. The cascade engine traced it through public records — open the signal to see who they are and how to reach out.`,
          ctaLabel: 'Open the signal',
          ctaHref: '/client/watchlist',
          trail: v.trail
        };
      }
    } catch { /* non-fatal */ }
  }

  // "In motion" cards — pulled from existing dashboard data so they're real.
  if (data.brief.pipeline.total > 0) {
    motion.push({
      title: `${data.brief.pipeline.total} lead${data.brief.pipeline.total === 1 ? '' : 's'} in your pipeline${data.brief.pipeline.hot > 0 ? `, ${data.brief.pipeline.hot} scored hot` : ''}`,
      body: 'Live prospects ranked by their AI Living Score. The strongest are always on top — open your pipeline to act on them today.',
      linkLabel: 'Open your pipeline →',
      linkHref: '/client/leads',
      when: data.brief.pipeline.hot > 0 ? `${data.brief.pipeline.hot} hot` : 'live'
    });
  }
  if (data.liveCount > 0) {
    motion.push({
      title: `${data.liveCount} piece${data.liveCount === 1 ? '' : 's'} live on the Wire`,
      body: 'Your stories are out in the world, signed and dated. See how they\'re traveling on The Atlantic & Vine Wire.',
      linkLabel: 'Read the features →',
      linkHref: '/newsroom',
      when: 'published'
    });
  }
  if (data.inMotion > 0) {
    motion.push({
      title: `${data.inMotion} piece${data.inMotion === 1 ? '' : 's'} in motion`,
      body: 'Scheduled across your channels for the coming days, in your voice. Approve the set or send notes.',
      linkLabel: 'Review the queue →',
      linkHref: '/client/social/review',
      when: 'queued'
    });
  }
  if (data.audit && motion.length < 3) {
    motion.push({
      title: 'Your strategic audit is current',
      body: 'A living read on your audience, market, and pipeline. Refreshed as new signals land.',
      linkLabel: 'Open the audit →',
      linkHref: '/client/audit',
      when: 'ready'
    });
  }
  if (motion.length === 0) {
    motion.push({
      title: 'Your channel is being set in motion',
      body: 'Your first audit and signals will appear here as the engine finds them. Nothing publishes until you approve — review, refine, release.',
      linkLabel: 'Set up your details →',
      linkHref: '/client/intake',
      when: 'soon'
    });
  }

  // Brand switcher chips.
  const brandsRaw = await listBrandsForUser(actor.clientUserId);
  const brands = brandsRaw.map((b) => ({
    id: String(b.clientId),
    label: b.clientName || `Brand ${b.clientId}`
  }));

  return (
    <>
      <WelcomePopover
        clientUserId={user.client_user_id}
        firstName={data.firstName}
        brandName={user.display_name || data.firstName || 'your business'}
        tier={user.tier}
      />
      <ClientDashboardV3
        firstName={data.firstName}
        weekLabel={weekLabelNow()}
        brands={brands}
        activeBrandId={String(clientId ?? '')}
        hero={heroProps}
        motion={motion}
      />
    </>
  );
}
