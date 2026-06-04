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
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';
import { getCopyMap } from '@/lib/copy/store';
import { accent } from '@/lib/copy/accent';

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

  // Per-client editable framing copy (edit in /admin/av/copy, this client or global).
  const copy = await getCopyMap(['watchlist.eyebrow', 'watchlist.h1', 'watchlist.lede'], { clientId: clientId ?? undefined });

  return (
    <main className="v3-wrap">
      <ClientV3TopNav />

      <section className="v3-greet">
        <p className="v3-eyebrow">{copy['watchlist.eyebrow']}</p>
        <h1 className="v3-h1">{accent(copy['watchlist.h1'], { firstName })}</h1>
        <p className="v3-lede">{copy['watchlist.lede']}</p>
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
