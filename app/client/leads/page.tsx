/**
 * /client/leads
 *
 * Mobile-app pipeline page. Same design vocabulary as /client/dashboard:
 *   - Sticky top bar (.app-top)
 *   - Fraunces greeting (.app-hello) — "Your pipeline, Adriana"
 *   - Brand switcher Stories row (.app-brands) — same as dashboard
 *   - Section head (.app-sh) with count chip + Find-new-leads link
 *   - SignalCard grid (.app-cards / .app-card) — every lead = same card shape
 *
 * The whole experience reads as one continuous app, not a per-page invention.
 * Styles come from app/client/_styles/app.css (loaded by client/layout.tsx).
 * Auth + access + tier gates preserved verbatim from the prior page.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { listClientLeads, type ClientLead } from '@/lib/client/leads';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import { listBrandsForUser } from '@/lib/client/membership';
import AccessPaused from '@/app/client/_components/AccessPaused';
import LeadsView from './LeadsView';
import { getCopyMap } from '@/lib/copy/store';
import { accent } from '@/lib/copy/accent';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

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

  // Brand switcher — same shape as the dashboard's Stories row.
  let brands: { id: number; name: string; initials: string; href: string; active: boolean }[] = [];
  try {
    const memberships = await listBrandsForUser(actor.clientUserId);
    brands = memberships.map((m) => ({
      id: m.clientId,
      name: m.clientName || `Brand ${m.clientId}`,
      initials: initialsOf(m.clientName || `B${m.clientId}`),
      href: `/client/leads?brand=${m.clientId}`,
      active: m.clientId === clientId
    }));
  } catch { brands = []; }

  const hot = leads.filter((l) => l.band === 'hot').length;
  const userInitial = firstName.charAt(0).toUpperCase();

  // Per-client editable greeting headline.
  const copy = await getCopyMap(['leads.h1'], { clientId: clientId ?? undefined });

  return (
    <>
      {/* Top bar — identical to the dashboard's */}
      <div className="app-top">
        <div className="app-top-in">
          <img src="https://atlanticandvine.netlify.app/av-logo.png" alt="A&amp;V" />
          <span className="bt">Atlantic &amp; Vine</span>
          <span className="pill">Client</span>
          <div className="me">
            <span>{firstName}</span>
            <span className="av" aria-hidden="true">{userInitial}</span>
          </div>
        </div>
      </div>

      <div className="app-wrap">
        {/* Greeting */}
        <section className="app-hello">
          <h1>{accent(copy['leads.h1'], { firstName })}</h1>
          <p>
            {locked
              ? 'Lead discovery finds and scores prospects for your business automatically. Unlocks on Sprint.'
              : leads.length > 0
                ? `${leads.length} in your pipeline${hot > 0 ? ` · ${hot} scored hot` : ''}. Best-fit first.`
                : 'Prospects for your business land here, best-fit first.'}
          </p>
        </section>

        {/* Brand switcher Stories — same as dashboard */}
        {brands.length > 0 && (
          <div className="app-brands" aria-label="Switch brand">
            {brands.map((b) => (
              <Link
                key={b.id}
                href={b.href}
                className={`app-brand${b.active ? ' on' : ''}`}
                aria-current={b.active ? 'page' : undefined}
              >
                <div className="ring">
                  <div className="pic">{b.initials}</div>
                </div>
                <span className="lbl">{b.name}</span>
              </Link>
            ))}
            <Link href="/client/intake" className="app-brand add">
              <div className="ring"><div className="pic">+</div></div>
              <span className="lbl">Add brand</span>
            </Link>
          </div>
        )}

        {locked ? (
          <div className="app-empty" style={{ textAlign: 'left' }}>
            <p>
              <strong style={{ color: 'var(--black)' }}>Lead discovery unlocks on Sprint.</strong>
              {' '}You&apos;re on the audit tier. Upgrade to have prospects discovered, enriched, and
              scored for your business automatically — strongest fits always on top.
            </p>
            <p style={{ marginTop: '0.7rem' }}>
              <a
                className="app-cta"
                href="mailto:val@atlanticandvine.com?subject=Upgrade%20to%20Sprint"
              >
                Talk to Val about upgrading →
              </a>
            </p>
          </div>
        ) : (
          <LeadsView leads={leads} />
        )}
      </div>
    </>
  );
}
