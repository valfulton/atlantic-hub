/**
 * /client/pr  (#220)
 *
 * Client-facing PR opportunity list + approval workflow. The journalist
 * requests + RSS / Reddit matches that landed for THIS client's leads,
 * each with a drafted pitch in their voice they can approve, decline, or
 * send back for review before it goes out.
 *
 * Tier gate: PR is a Momentum+ capability. Sprint clients see an upgrade
 * panel; audit_only clients see the same. Lead-discovery itself is Sprint+
 * (so a Sprint client may have leads but no PR; that's fine -- the page
 * just renders the gate).
 *
 * Mirror: an operator-side preview of THIS page lives at
 * /admin/av/clients/[client_id]/preview/pr -- if you change the structure
 * here, mirror the change there too (see Mirror_Pattern.md).
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
import PortalHeader from '@/app/client/_components/PortalHeader';
import AccessPaused from '@/app/client/_components/AccessPaused';
import ClientPrView from './ClientPrView';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientPrPage() {
  const actor = readClientActorFromHeaders(headers() as unknown as Headers);
  if (!actor) redirect('/client/login');

  const user = await findClientUserById(actor.clientUserId);
  if (!user) redirect('/client/login');

  // Self-heal provisioning for older accounts (mirrors /client/leads).
  if (!user.client_id) {
    try {
      const cid = await ensureClientHub(user);
      if (cid) user.client_id = cid;
    } catch {
      /* non-fatal */
    }
  }

  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);

  // Access gate (same as /client/leads + /client/dashboard).
  if (clientId) {
    const access = await getClientAccessState(clientId);
    if (!access.active) {
      return (
        <>
          <PortalHeader displayName={user.display_name} email={user.email} tier={user.tier} active="pr" />
          <AccessPaused expired={access.expired} />
        </>
      );
    }
  }

  const headline = user.display_name?.split(/[ ,]/)[0] || 'there';
  // PR is a Momentum+ feature. Sprint clients are locked behind an upgrade
  // pitch (kept simple -- the dashboard already shows the full tier matrix).
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
    <>
      <PortalHeader displayName={user.display_name} email={user.email} tier={user.tier} active="dashboard" />

      <main className="w-full max-w-6xl mx-auto px-3 sm:px-4 py-6 sm:py-10">
        <section
          className="mb-8 rounded-2xl border border-border overflow-hidden"
          style={{
            background:
              'radial-gradient(120% 140% at 0% 0%, rgba(245,158,11,0.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))'
          }}
        >
          <div className="px-6 sm:px-8 py-7">
            <div className="text-[10px] uppercase tracking-[0.22em] text-brand mb-2">Your press queue</div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">In the news for you, {headline}.</h1>
            <p className="text-muted text-sm mt-4 max-w-xl leading-relaxed">
              {locked
                ? 'Press opportunities — journalist requests + relevant stories matched to your business, with a drafted pitch in your voice for one-click approval. Unlocks on Momentum.'
                : opps.length > 0
                  ? `${opps.length} press opportunit${opps.length === 1 ? 'y' : 'ies'} matched to you${stats.urgent ? `, ${stats.urgent} urgent` : ''}. Approve, pass, or ask us to take another look — pitches are drafted in your voice and only go out with your nod.`
                  : 'When a journalist puts out a request that fits your story, we draft a pitch in your voice and surface it here for your approval.'}
            </p>
          </div>
        </section>

        {locked ? (
          <section className="rounded-2xl border border-dashed border-border bg-surface/60 p-8 text-center">
            <div className="text-3xl mb-3" aria-hidden="true">&#x1F4F0;</div>
            <h2 className="text-lg font-semibold text-ink">Press opportunities unlock on Momentum</h2>
            <p className="text-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">
              You&apos;re on the <span className="text-ink font-medium">{TIER_LABEL[user.tier]}</span> plan. Upgrade to
              Momentum to have journalist requests + media matches surfaced for your business, with pitches drafted
              in your voice and ready for one-click approval.
            </p>
            <a
              href="https://atlanticandvine.netlify.app/#pricing"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center justify-center mt-5 px-4 py-2 rounded-md bg-brand text-brand-fg text-sm font-medium hover:opacity-90"
            >
              See plans
            </a>
          </section>
        ) : (
          <ClientPrView opps={opps} stats={stats} headline={headline} mode="live" />
        )}

        <footer className="border-t border-border mt-12 pt-5 text-xs text-muted text-center">
          &copy; {new Date().getFullYear()} Atlantic And Vine LLC. Signed in as{' '}
          <span className="text-ink">{user.email}</span>.
        </footer>
      </main>
    </>
  );
}
