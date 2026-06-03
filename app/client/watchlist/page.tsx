/**
 * /client/watchlist  (#385, val 2026-06-03)
 *
 * The client's view of their own distress watchlist — Adriana logs in and
 * sees the top entities likely to need her service this week, scored from
 * public records. Per-row Draft (opener) and Add to pipeline (promote)
 * actions. Scoped strictly to the active brand via activeBrandFor().
 *
 * Naming: surfaced as "Watchlist" in the portal nav — industry-standard
 * language for collections / legal / B2B-sales teams, no "AI engine" framing
 * per the AI-verbiage rule (the craft is what we built, not the mechanism).
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import PortalHeader from '@/app/client/_components/PortalHeader';
import AccessPaused from '@/app/client/_components/AccessPaused';
import WaveDivider from '@/app/_components/WaveDivider';
import DistressWatchlistPanel from '@/app/admin/av/clients/[client_id]/DistressWatchlistPanel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientWatchlistPage() {
  const actor = readClientActorFromHeaders(headers() as unknown as Headers);
  if (!actor) redirect('/client/login');

  const user = await findClientUserById(actor.clientUserId);
  if (!user) redirect('/client/login');

  // Self-heal provisioning for accounts created before it landed.
  if (!user.client_id) {
    try {
      const cid = await ensureClientHub(user);
      if (cid) user.client_id = cid;
    } catch { /* non-fatal */ }
  }

  // Multi-brand: scope to the brand the owner is currently viewing.
  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);

  // Access gate (lapsed/revoked = calm paused screen).
  if (clientId) {
    const access = await getClientAccessState(clientId);
    if (!access.active) {
      return (
        <>
          <PortalHeader displayName={user.display_name} email={user.email} tier={user.tier} active="watchlist" />
          <AccessPaused expired={access.expired} />
        </>
      );
    }
  }

  const headline = user.display_name?.split(/[ ,]/)[0] || 'there';
  const audit_only = user.tier === 'audit_only';
  const brandName = user.display_name || 'your business';

  return (
    <>
      <PortalHeader displayName={user.display_name} email={user.email} tier={user.tier} active="watchlist" />

      <main className="w-full max-w-6xl mx-auto px-3 sm:px-4 py-6 sm:py-10">
        <section
          className="mb-8 rounded-2xl border border-border overflow-hidden"
          style={{
            background:
              'radial-gradient(120% 140% at 0% 0%, rgba(239,68,68,0.10), transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))'
          }}
        >
          <div className="px-6 sm:px-8 py-7">
            <div className="text-[10px] uppercase tracking-[0.22em] text-red-300 mb-2">Your watchlist</div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-ink tracking-tight">Who&apos;s about to need you, {headline}.</h1>
            <WaveDivider className="mt-3" width={120} />
            <p className="text-muted text-sm mt-4 max-w-xl leading-relaxed">
              {audit_only
                ? 'Your watchlist surfaces businesses showing public signals of distress — court filings, suspensions, vendor exposure, review trends. It unlocks on the Sprint plan.'
                : 'Businesses showing public signals of distress are ranked here every morning. Click ✎ Draft to write an opener that references the signal, or ✚ Add to pipeline to start working the prospect.'}
            </p>
          </div>
        </section>

        {audit_only ? (
          <section className="rounded-2xl border border-dashed border-border bg-surface/60 p-8 text-center">
            <div className="text-3xl mb-3" aria-hidden="true">&#x2693;</div>
            <h2 className="text-lg font-semibold text-ink">Watchlist is a Sprint feature</h2>
            <p className="text-sm text-muted mt-2 max-w-md mx-auto leading-relaxed">
              You&apos;re currently on the audit tier. Upgrade to Sprint to have predictive signals surfaced for your
              business every morning.
            </p>
          </section>
        ) : !clientId ? (
          <section className="rounded-2xl border border-dashed border-border bg-surface/60 p-8 text-center">
            <p className="text-sm text-muted">Setting up your watchlist… come back in a moment.</p>
          </section>
        ) : (
          <DistressWatchlistPanel clientId={clientId} clientName={brandName} mode="client" />
        )}
      </main>
    </>
  );
}
