/**
 * /client/intelligence  (#321)
 *
 * The client's always-current "what your investment produced" view — the live
 * companion to the Weekly Learned Digest. Shows the Created → Activated →
 * Revenue chain in plain, outcome-first language. No raw lists, no machinery.
 *
 * Tier gate: Sprint+ (audit_only sees an upgrade panel — their hub doesn't
 * produce activity yet). Body is shared with the operator preview at
 * /admin/av/clients/[client_id]/preview/intelligence (mirror-every-client rule).
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
import PortalHeader from '@/app/client/_components/PortalHeader';
import AccessPaused from '@/app/client/_components/AccessPaused';
import IntelligenceImpactBody from '@/app/client/_components/IntelligenceImpactBody';

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
        <>
          <PortalHeader displayName={user.display_name} email={user.email} tier={user.tier} active="intelligence" />
          <AccessPaused expired={access.expired} />
        </>
      );
    }
  }

  const headline = user.display_name?.split(/[ ,]/)[0] || 'there';
  // Sprint+ gate: audit_only hubs don't produce activity yet.
  const locked = user.tier === 'audit_only';

  return (
    <>
      <PortalHeader displayName={user.display_name} email={user.email} tier={user.tier} active="intelligence" />

      {locked || !clientId ? (
        <main className="w-full max-w-6xl mx-auto px-3 sm:px-4 py-6 sm:py-10">
          <section
            className="mb-8 rounded-2xl border border-border overflow-hidden"
            style={{
              background:
                'radial-gradient(120% 140% at 0% 0%, rgba(245,158,11,0.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))'
            }}
          >
            <div className="px-6 sm:px-8 py-7">
              <div className="text-[10px] uppercase tracking-[0.22em] text-brand mb-2">Your impact</div>
              <h1 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">See your work compound, {headline}.</h1>
            </div>
          </section>
          <section className="rounded-2xl border border-dashed border-border bg-surface/60 p-8 text-center">
            <div className="text-3xl mb-3" aria-hidden="true">&#x1F4C8;</div>
            <h2 className="text-lg font-semibold text-ink">Your impact view unlocks on Sprint</h2>
            <p className="text-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">
              You&apos;re on the <span className="text-ink font-medium">{TIER_LABEL[user.tier]}</span> plan. On Sprint and up,
              this page shows everything we learn about your market, where we put it to work, and the revenue motion it
              drives — updated live.
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
        </main>
      ) : (
        <IntelligenceImpactBody trifecta={await loadIntelligenceTrifecta({ clientId, sinceDays: 30 })} headline={headline} />
      )}

      <footer className="border-t border-border max-w-6xl mx-auto px-4 mt-12 pt-5 text-xs text-muted text-center">
        &copy; {new Date().getFullYear()} Atlantic And Vine LLC. Signed in as{' '}
        <span className="text-ink">{user.email}</span>.
      </footer>
    </>
  );
}
