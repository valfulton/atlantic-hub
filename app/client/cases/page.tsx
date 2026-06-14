/**
 * /client/cases  (val 2026-06-11, Phase 2)
 *
 * Client-side case list. Rebecca + parents + invited siblings see this.
 * Scoped to the logged-in client via activeBrandFor() — no IDOR.
 * Cream client skin (matches /client/dashboard + /client/leads pattern).
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import AccessPaused from '@/app/client/_components/AccessPaused';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';
import { listCasesAccessibleByClientUser } from '@/lib/case/case_store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function caseKindLabel(k: string): string {
  switch (k) {
    case 'trust_dispute': return 'Trust matter';
    case 'elder_advocacy': return 'Family care';
    case 'estate_litigation': return 'Estate matter';
    case 'malpractice_defense': return 'Defense matter';
    case 'campaign_legal': return 'Campaign legal';
    case 'guardianship': return 'Guardianship';
    case 'family_law': return 'Family law';
    case 'business_litigation': return 'Business matter';
    case 'general_litigation':
    default:
      return 'Matter';
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

export default async function ClientCasesPage() {
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
  if (!clientId) redirect('/client/dashboard');

  const access = await getClientAccessState(clientId);
  if (!access.active) {
    return <AccessPaused expired={access.expired} />;
  }

  // Includes cases where this user is invited as a collaborator (attorney /
  // advisor / sibling-reader) plus cases on their primary client_id. Adriana
  // sees Johnson here once invited + parent-approved without leaving her own
  // CBB portal.
  const cases = await listCasesAccessibleByClientUser(actor.clientUserId, clientId);
  const openCases = cases.filter((c) => c.status === 'open');
  const otherCases = cases.filter((c) => c.status !== 'open');

  return (
    <>
      {/* (val 2026-06-13) Mount ClientV3TopNav so Rebecca / Adriana / parents
          actually have a nav bar to move between Home, Matters, Leads, etc.
          Without this, the cases pages had NO top-of-page navigation on
          desktop (mobile gets BottomTabBar from the layout, but desktop is
          ClientV3TopNav only). Mirrors the pattern used by /client/leads,
          /client/calendar, /client/pr — every page that takes a logged-in
          client mounts its own ClientV3TopNav. */}
      <ClientV3TopNav />
    <main className="min-h-screen" style={{ background: 'var(--cream, #FAF8F4)', color: 'var(--ink, #14201B)' }}>
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '2.5rem 1.25rem 4rem' }}>
        <header style={{ marginBottom: '2rem' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--gold-deep, #7A5A18)', marginBottom: 8 }}>
            ATLANTIC &amp; VINE
          </div>
          <h1 style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontWeight: 500, fontSize: 38, lineHeight: 1.1, marginBottom: 8 }}>
            Your <em>matters</em>
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--muted, #5C6862)' }}>
            Everything we are tracking together. Open the matter to see the timeline, documents, decisions, and what is up next.
          </p>
        </header>

        {cases.length === 0 ? (
          <div style={{ background: 'var(--paper, #FFFFFF)', border: '0.5px solid rgba(10,10,10,0.1)', borderRadius: 14, padding: '2rem', textAlign: 'center' }}>
            <div style={{ color: 'var(--muted, #5C6862)', fontStyle: 'italic' }}>
              No active matters yet. We will reach out when there is something to review.
            </div>
          </div>
        ) : (
          <>
            {openCases.length > 0 && (
              <section style={{ marginBottom: '2.5rem' }}>
                <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold-deep, #7A5A18)', marginBottom: 12 }}>
                  Currently active
                </div>
                <div style={{ display: 'grid', gap: 14 }}>
                  {openCases.map((c) => (
                    <Link
                      key={c.caseId}
                      href={`/client/cases/${c.caseId}`}
                      style={{
                        display: 'block',
                        background: 'var(--paper, #FFFFFF)',
                        border: '0.5px solid rgba(10,10,10,0.1)',
                        borderRadius: 14,
                        padding: '20px 22px',
                        textDecoration: 'none',
                        color: 'inherit'
                      }}
                    >
                      <div style={{ fontSize: 11, color: 'var(--muted, #5C6862)', marginBottom: 6 }}>
                        {caseKindLabel(c.caseKind)} · Opened {formatDate(c.openedAt)}
                      </div>
                      <h2 style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontWeight: 500, fontSize: 22, marginBottom: 8 }}>
                        {c.caseName}
                      </h2>
                      {c.caseSynopsis && (
                        <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--muted, #5C6862)', marginBottom: 10 }}>
                          {c.caseSynopsis.length > 220 ? c.caseSynopsis.slice(0, 220) + '…' : c.caseSynopsis}
                        </p>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--gold-deep, #7A5A18)', marginTop: 8 }}>
                        Open the matter →
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {otherCases.length > 0 && (
              <section>
                <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #5C6862)', marginBottom: 12 }}>
                  Resolved
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {otherCases.map((c) => (
                    <Link
                      key={c.caseId}
                      href={`/client/cases/${c.caseId}`}
                      style={{
                        display: 'block',
                        background: 'transparent',
                        border: '0.5px solid rgba(10,10,10,0.08)',
                        borderRadius: 12,
                        padding: '14px 18px',
                        textDecoration: 'none',
                        color: 'var(--muted, #5C6862)'
                      }}
                    >
                      <div style={{ fontSize: 12 }}>
                        {c.caseName} <span style={{ marginLeft: 8, fontSize: 10, textTransform: 'uppercase' }}>{c.status}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
    </>
  );
}
