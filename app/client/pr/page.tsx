/**
 * /client/pr  — V3 (Velvet Royale chat, 2026-06-03)
 *
 * Client-facing PR opportunity list + approval workflow, in the V3 navy
 * register: ClientV3TopNav → Cormorant greeting → ClientPrView (inherits the
 * navy skin via the token remap in skin.social.css). No PortalHeader, no hero
 * gradient, no WaveDivider. Mirror: /admin/av/clients/[client_id]/preview/pr.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import { TIER_LABEL } from '@/lib/client-portal/tiers';
import {
  listPrOpportunitiesForClientView,
  summarizeForClient,
  type ClientFacingPrOpportunity,
  type ClientPrSummary
} from '@/lib/pr/client_pr_actions';
import AccessPaused from '@/app/client/_components/AccessPaused';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';
import ClientPrView from './ClientPrView';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientPrPage() {
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

  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);

  if (clientId) {
    const access = await getClientAccessState(clientId);
    if (!access.active) {
      return (
        <main className="v3-wrap">
          <ClientV3TopNav />
          <AccessPaused expired={access.expired} />
        </main>
      );
    }
  }

  const headline = user.display_name?.split(/[ ,]/)[0] || 'there';
  const locked = user.tier === 'audit_only' || user.tier === 'sprint';

  let opps: ClientFacingPrOpportunity[] = [];
  let stats: ClientPrSummary = { total: 0, awaitingMyApproval: 0, iApproved: 0, iSentForReview: 0, urgent: 0 };
  if (!locked && clientId) {
    try {
      opps = await listPrOpportunitiesForClientView(clientId, { limit: 30 });
      stats = summarizeForClient(opps);
    } catch {
      opps = [];
    }
  }

  return (
    <main className="v3-wrap" style={{ maxWidth: 900 }}>
      <ClientV3TopNav />

      <section className="v3-greet">
        <p className="v3-eyebrow">Your press queue</p>
        <h1 className="v3-h1">Your press is <em>moving.</em></h1>
        <p className="v3-lede" style={{ fontStyle: 'normal', fontSize: 16 }}>
          {locked
            ? 'Journalist requests and media matches for your business, with a pitch drafted in your voice for one-click approval. Unlocks on Momentum.'
            : opps.length > 0
              ? `${opps.length} press opportunit${opps.length === 1 ? 'y' : 'ies'} matched to you${stats.urgent ? `, ${stats.urgent} urgent` : ''}. Pitches are drafted in your voice and only go out with your nod.`
              : 'When a journalist puts out a request that fits your story, we draft a pitch in your voice and surface it here for your approval.'}
        </p>
      </section>

      {locked ? (
        <article className="v3-card">
          <h2 className="v3-card__h">Press opportunities unlock on Momentum</h2>
          <p className="v3-card__p">
            You&rsquo;re on the {TIER_LABEL[user.tier]} plan. Upgrade to Momentum to have journalist requests and media
            matches surfaced for your business, with pitches drafted in your voice and ready for one-click approval.
          </p>
          <a
            className="v3-cta"
            href="https://atlanticandvine.netlify.app/#pricing"
            target="_blank"
            rel="noopener"
          >
            See plans
          </a>
        </article>
      ) : (
        <ClientPrView opps={opps} stats={stats} headline={headline} mode="live" />
      )}

      <p className="v3-foot" style={{ textAlign: 'left', marginTop: 28 }}>
        Signed in as {user.email}
      </p>
    </main>
  );
}
