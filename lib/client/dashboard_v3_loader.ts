/**
 * lib/client/dashboard_v3_loader.ts  (#397, val 2026-06-03)
 *
 * THE shared loader that feeds the V3 client dashboard. Called from TWO
 * places — and only ever two:
 *
 *   1. app/client/dashboard/page.tsx        — the live client view
 *   2. app/admin/av/clients/[id]/preview/page.tsx — the operator preview mirror
 *
 * Both pages call this with `{ clientId, clientUserId, firstName }` and get
 * back a `ClientDashboardV3Props` object. They render the SAME body.
 * Because the loader is one function and the body is one component, the
 * preview and the live view CANNOT drift.
 *
 * If you find yourself adding a third caller — don't. Add another preview
 * surface (sibling /preview/* route) and have it call this loader too.
 */
import { watchlistForClient } from '@/lib/public_intel/distress_engine';
import { buildSignalCardData } from '@/lib/public_intel/signal_voice';
import { listBrandsForUser } from '@/lib/client/membership';
import type { ClientDashboardData } from '@/lib/client/dashboard_data';
import type { ClientDashboardV3Props, DashboardCardData } from '@/app/client/dashboard/ClientDashboardV3';

export function weekLabelNow(): string {
  const d = new Date();
  const day = d.getDate();
  const month = d.toLocaleString('en', { month: 'long' });
  return `Your channel · week of ${day} ${month}`;
}

export interface DashboardV3LoaderArgs {
  /** The client_id we're viewing (the active brand). May be null for new accounts pre-provision. */
  clientId: number | null;
  /** The client_user_id of the logged-in person (live page) OR a representative member (preview). */
  clientUserId: number;
  /** Already-loaded dashboard data — pulled by the caller via getClientDashboardData(). */
  data: ClientDashboardData;
}

export async function loadDashboardV3(args: DashboardV3LoaderArgs): Promise<ClientDashboardV3Props> {
  const { clientId, clientUserId, data } = args;

  // Build hero from the top distress watchlist row, if any.
  let hero: ClientDashboardV3Props['hero'] = null;
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
        hero = {
          label: "This week's strongest signal",
          title: v.headline,
          body: `${top.entityLabel || 'A new prospect'} came up as worth watching this week — open it to see who they are and how to reach out.`,
          ctaLabel: 'Open the signal',
          ctaHref: '/client/watchlist',
          trail: v.trail
        };
      }
    } catch { /* non-fatal */ }
  }

  // "In motion" cards — pulled from existing dashboard data so they're real.
  const motion: DashboardCardData[] = [];
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
      title: 'No activity yet on this account.',
      body: 'Your audit and pipeline will populate as records post. Nothing publishes without your approval.',
      linkLabel: 'Complete your details →',
      linkHref: '/client/intake',
      when: ''
    });
  }

  // Brand chips (for owners running multiple brands under one login).
  const brandsRaw = await listBrandsForUser(clientUserId);
  const brands = brandsRaw.map((b) => ({
    id: String(b.clientId),
    label: b.clientName || `Brand ${b.clientId}`
  }));

  return {
    firstName: data.firstName,
    weekLabel: weekLabelNow(),
    brands,
    activeBrandId: String(clientId ?? ''),
    hero,
    motion
  };
}
