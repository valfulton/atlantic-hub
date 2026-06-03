/**
 * /client/watchlist  (#398, val 2026-06-03, per VR V3 watchlist spec)
 *
 * V3 — luxury Cormorant register, no PortalHeader, no WaveDivider, no
 * red gradient hero. Thin page: auth + provision + access-gate, then
 * the V3 shell wraps `ClientWatchlistV3` (which fetches and renders the
 * SignalCards with the cascade-trail story).
 *
 * The data-skin="social" ancestor comes from app/client/layout.tsx, so
 * the v3-* classes resolve automatically here.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import AccessPaused from '@/app/client/_components/AccessPaused';
import ClientWatchlistV3 from '@/app/client/_components/ClientWatchlistV3';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientWatchlistPage() {
  const actor = readClientActorFromHeaders(headers() as unknown as Headers);
  if (!actor) redirect('/client/login');

  const user = await findClientUserById(actor.clientUserId);
  if (!user) redirect('/client/login');

  if (!user.client_id) {
    try {
      const cid = await ensureClientHub(user);
      if (cid) user.client_id = cid;
    } catch { /* non-fatal */ }
  }

  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);

  if (clientId) {
    const access = await getClientAccessState(clientId);
    if (!access.active) {
      return <AccessPaused expired={access.expired} />;
    }
  }

  const firstName = user.display_name?.split(/[ ,]/)[0] || 'there';
  const isAuditOnly = user.tier === 'audit_only';

  return (
    <main className="v3-wrap">
      <header className="v3-top">
        <img src="/brand/av-monogram.png" alt="Atlantic & Vine" className="v3-top__logo" />
        <span className="v3-top__nm">Atlantic &amp; Vine</span>
      </header>

      <section className="v3-greet">
        <p className="v3-eyebrow">Your watchlist</p>
        <h1 className="v3-h1">
          Who&apos;s about to need you, <em>{firstName}.</em>
        </h1>
        <p className="v3-lede">
          Businesses showing public signals of distress, ranked every morning. Open one to see who
          they are and how to reach out.
        </p>
      </section>

      {isAuditOnly ? (
        <article className="v3-card">
          <h3 className="v3-card__h">Watchlist unlocks on Sprint.</h3>
          <p className="v3-card__p">
            You&apos;re currently on the audit tier. Upgrade to Sprint to have predictive signals — court
            filings, suspensions, vendor exposure, review trends — surfaced for your business every
            morning, ranked by who&apos;s most likely to need you this week.
          </p>
          <div className="v3-card__row">
            <a className="v3-link" href="mailto:val@atlanticandvine.com?subject=Upgrade%20to%20Sprint">
              Talk to Val about upgrading →
            </a>
          </div>
        </article>
      ) : !clientId ? (
        <article className="v3-card">
          <h3 className="v3-card__h">Setting up your watchlist…</h3>
          <p className="v3-card__p">
            Come back in a moment — we&apos;re wiring your account to the cascade engine.
          </p>
        </article>
      ) : (
        <ClientWatchlistV3 />
      )}

      <p className="v3-foot">QUIET · LEGIBLE · VERIFIABLE</p>
    </main>
  );
}
