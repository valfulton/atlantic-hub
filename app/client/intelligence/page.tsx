/**
 * /client/intelligence  — V3 (Velvet Royale chat, 2026-06-03)
 *
 * The Created → Activated → Revenue chain in plain language. V3 shell
 * (ClientV3TopNav + Cormorant), body = IntelligenceImpactBody (inherits the
 * navy skin via the token remap). No PortalHeader / hero gradient / WaveDivider.
 * Mirror: /admin/av/clients/[client_id]/preview/intelligence.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import { TIER_LABEL } from '@/lib/client-portal/tiers';
import { loadIntelligenceTrifecta } from '@/lib/av/intelligence_metrics';
import AccessPaused from '@/app/client/_components/AccessPaused';
import IntelligenceImpactBody from '@/app/client/_components/IntelligenceImpactBody';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientIntelligencePage() {
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
  const locked = user.tier === 'audit_only';

  return (
    <main className="v3-wrap">
      <ClientV3TopNav />

      {locked || !clientId ? (
        <>
          <section className="v3-greet">
            <p className="v3-eyebrow">Your impact</p>
            <h1 className="v3-h1">See your work <em>compound.</em></h1>
          </section>
          <article className="v3-card">
            <h2 className="v3-card__h">Your impact view unlocks on Sprint</h2>
            <p className="v3-card__p">
              You&rsquo;re on the {TIER_LABEL[user.tier]} plan. On Sprint and up, this page shows the records saved
              about your market, where we put it to work, and the revenue motion it drives — updated live.
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
        </>
      ) : (
        <IntelligenceImpactBody
          trifecta={await loadIntelligenceTrifecta({ clientId, sinceDays: 30 })}
          headline={headline}
        />
      )}

      <p className="v3-foot" style={{ textAlign: 'left', marginTop: 28 }}>
        Signed in as {user.email}
      </p>
    </main>
  );
}
