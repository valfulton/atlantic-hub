/**
 * /client/leads  (#401, val 2026-06-03, per VR V3 leads spec)
 *
 * V3 — luxury Cormorant register. Worst-offender page on the kill list:
 * the amber radial-gradient hero, the colored band pills, the rose
 * "No working website" dot, the rose "Avoid:" all gone. The body now
 * uses `ClientLeadCardV3` which is shared with the operator preview
 * mirror — single source of truth, cannot drift.
 *
 * Auth + provision + active-brand + access-gate + tier gate logic
 * preserved verbatim. Only the markup register changes.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { listClientLeads, type ClientLead } from '@/lib/client/leads';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import AccessPaused from '@/app/client/_components/AccessPaused';
import ClientLeadCardV3 from '@/app/client/_components/ClientLeadCardV3';
import DiscoverPanel from './DiscoverPanel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientLeadsPage() {
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
  const locked = user.tier === 'audit_only';

  let leads: ClientLead[] = [];
  if (!locked) {
    try {
      leads = await listClientLeads({ client_id: clientId });
    } catch {
      leads = [];
    }
  }

  const hot = leads.filter((l) => l.band === 'hot').length;

  return (
    <main className="v3-wrap" style={{ maxWidth: 980 }}>
      <header className="v3-top">
        <img src="/brand/av-monogram.png" alt="Atlantic & Vine" className="v3-top__logo" />
        <span className="v3-top__nm">Atlantic &amp; Vine</span>
      </header>

      <section className="v3-greet">
        <p className="v3-eyebrow">Your pipeline</p>
        <h1 className="v3-h1">
          Your leads, <em>{firstName}.</em>
        </h1>
        <p className="v3-lede">
          {locked
            ? 'Lead discovery finds and scores prospects for your business automatically. Unlocks on Sprint.'
            : leads.length > 0
              ? `${leads.length} in your pipeline${hot > 0 ? `, ${hot} scored hot` : ''}. Ranked best-first.`
              : 'We surface prospects for your business and they land here, best-first.'}
        </p>
      </section>

      {!locked && (
        <div style={{ marginTop: '8px', marginBottom: '24px' }}>
          <DiscoverPanel />
        </div>
      )}

      {locked ? (
        <article className="v3-card">
          <h3 className="v3-card__h">Lead discovery unlocks on Sprint.</h3>
          <p className="v3-card__p">
            You&apos;re on the audit tier. Upgrade to Sprint to have prospects discovered, enriched, and
            scored for your business automatically — the strongest fits always on top.
          </p>
          <div className="v3-card__row">
            <a className="v3-link" href="mailto:val@atlanticandvine.com?subject=Upgrade%20to%20Sprint">
              Talk to Val about upgrading →
            </a>
          </div>
        </article>
      ) : leads.length === 0 ? (
        <article className="v3-card">
          <h3 className="v3-card__h">Your pipeline is warming up.</h3>
          <p className="v3-card__p">
            We&apos;re discovering and scoring prospects for your business. As they come in, each one
            appears here ranked by its AI Living Score, so you always see your strongest opportunities
            first.
          </p>
        </article>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '14px' }}>
          {leads.map((l) => (
            <ClientLeadCardV3
              key={l.id}
              lead={l}
              leadHref={l.auditId ? `/client/leads/${l.auditId}` : '#'}
            />
          ))}
        </div>
      )}

      <p className="v3-foot">Signed in as {user.email}</p>
    </main>
  );
}
