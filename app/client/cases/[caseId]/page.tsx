/**
 * /client/cases/[caseId]  (val 2026-06-11, Phase 2)
 *
 * Client case detail (cream skin). Rebecca + parents + invited siblings.
 * Scoped via activeBrandFor() — case.clientId MUST match the resolved
 * client; otherwise 404 (no IDOR via path param).
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import AccessPaused from '@/app/client/_components/AccessPaused';
import { loadFullCase } from '@/lib/case/case_store';
import { loadFullWellness } from '@/lib/case/family_wellness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PageProps {
  params: { caseId: string };
}

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

function dollars(cents: number | null): string {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default async function ClientCaseDetailPage({ params }: PageProps) {
  const caseId = parseInt(params.caseId, 10);
  if (!Number.isInteger(caseId)) notFound();

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

  const full = await loadFullCase(caseId);
  if (!full) notFound();

  // Critical: prevent IDOR. The case must belong to this client.
  if (full.case.clientId !== clientId) notFound();

  const c = full.case;
  const wellness = c.wellnessEnabled ? await loadFullWellness(caseId) : null;

  // Show only OPEN/IN-PROGRESS action items to clients; completed live in archive
  const openActions = full.actionItems.filter((a) => a.status !== 'done');

  return (
    <main className="min-h-screen" style={{ background: 'var(--cream, #FAF8F4)', color: 'var(--ink, #14201B)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1.25rem 4rem' }}>
        {/* Breadcrumb */}
        <div style={{ fontSize: 11, color: 'var(--muted, #5C6862)', marginBottom: 18 }}>
          <Link href="/client/cases" style={{ color: 'var(--gold-deep, #7A5A18)' }}>Your matters</Link>
          <span style={{ margin: '0 6px' }}>·</span>
          <span>{c.caseName}</span>
        </div>

        {/* Header */}
        <header style={{ marginBottom: '2rem' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold-deep, #7A5A18)', marginBottom: 8 }}>
            {caseKindLabel(c.caseKind)}
          </div>
          <h1 style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontWeight: 500, fontSize: 36, lineHeight: 1.1, marginBottom: 10 }}>
            {c.caseName}
          </h1>
          <div style={{ fontSize: 12, color: 'var(--muted, #5C6862)' }}>
            Opened {formatDate(c.openedAt)}
            {c.metadata?.trust_executed_date ? ` · Trust executed ${String(c.metadata.trust_executed_date)}` : ''}
          </div>
        </header>

        {/* Synopsis card */}
        {c.caseSynopsis && (
          <section style={{ background: 'var(--paper, #FFFFFF)', border: '0.5px solid rgba(10,10,10,0.1)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #5C6862)', marginBottom: 10 }}>
              Where we are
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{c.caseSynopsis}</div>
          </section>
        )}

        {/* Property */}
        {full.property && (
          <section style={{ background: 'var(--paper, #FFFFFF)', border: '0.5px solid rgba(10,10,10,0.1)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #5C6862)', marginBottom: 10 }}>
              The property
            </div>
            <div style={{ fontSize: 15, fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif' }}>
              {full.property.addressLine}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted, #5C6862)' }}>
              {[full.property.city, full.property.state, full.property.zip].filter(Boolean).join(', ')}
              {full.property.county ? ` · ${full.property.county} County` : ''}
            </div>
            {full.property.currentTitledOwner && (
              <div style={{ fontSize: 12, marginTop: 10 }}>
                <span style={{ color: 'var(--muted, #5C6862)' }}>Currently titled to:</span>{' '}
                <strong>{full.property.currentTitledOwner}</strong>
              </div>
            )}
            {(full.property.estimatedValueCents != null || full.property.equityCents != null) && (
              <div style={{ display: 'flex', gap: 24, fontSize: 12, marginTop: 8 }}>
                {full.property.estimatedValueCents != null && (
                  <div><span style={{ color: 'var(--muted, #5C6862)' }}>Est. value:</span> {dollars(full.property.estimatedValueCents)}</div>
                )}
                {full.property.equityCents != null && (
                  <div><span style={{ color: 'var(--muted, #5C6862)' }}>Equity:</span> {dollars(full.property.equityCents)}</div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Action items the family should act on */}
        {openActions.length > 0 && (
          <section style={{ background: 'var(--paper, #FFFFFF)', border: '0.5px solid rgba(10,10,10,0.1)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #5C6862)', marginBottom: 12 }}>
              What we are working on next
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
              {openActions.map((a) => (
                <li key={a.actionId} style={{ borderLeft: a.priority === 'urgent' ? '3px solid #A23B2E' : a.priority === 'high' ? '3px solid var(--gold-deep, #7A5A18)' : '3px solid rgba(10,10,10,0.15)', paddingLeft: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{a.title}</div>
                  {a.detail && (
                    <div style={{ fontSize: 12, color: 'var(--muted, #5C6862)', marginTop: 4, lineHeight: 1.55 }}>{a.detail}</div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--muted, #5C6862)', marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    {a.priority}
                    {a.dueDate ? ` · due ${formatDate(a.dueDate)}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Timeline */}
        {full.events.length > 0 && (
          <section style={{ background: 'var(--paper, #FFFFFF)', border: '0.5px solid rgba(10,10,10,0.1)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #5C6862)', marginBottom: 12 }}>
              Timeline
            </div>
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 14 }}>
              {full.events.map((e) => (
                <li key={e.eventId} style={{ borderLeft: '2px solid rgba(10,10,10,0.12)', paddingLeft: 14 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted, #5C6862)' }}>{formatDate(e.eventDate)}</div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{e.eventTitle}</div>
                  {e.eventDetail && (
                    <div style={{ fontSize: 12, color: 'var(--muted, #5C6862)', marginTop: 4, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{e.eventDetail}</div>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Document vault */}
        {full.documents.length > 0 && (
          <section style={{ background: 'var(--paper, #FFFFFF)', border: '0.5px solid rgba(10,10,10,0.1)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #5C6862)', marginBottom: 12 }}>
              Document vault
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {full.documents.map((d) => (
                <li key={d.documentId} style={{ fontSize: 13 }}>
                  <strong>{d.documentName}</strong>
                  {d.documentKind && (
                    <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--muted, #5C6862)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{d.documentKind}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Parties (people on the matter) */}
        {full.parties.length > 0 && (
          <section style={{ background: 'var(--paper, #FFFFFF)', border: '0.5px solid rgba(10,10,10,0.1)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #5C6862)', marginBottom: 12 }}>
              On this matter
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
              {full.parties.map((p) => (
                <li key={p.partyId} style={{ fontSize: 13 }}>
                  <strong>{p.fullName}</strong>
                  {p.role && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted, #5C6862)' }}>{p.role.replace(/_/g, ' ')}</span>
                  )}
                  {p.relationship && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted, #5C6862)', fontStyle: 'italic' }}>{p.relationship}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Family wellness summary (when wellness_enabled) */}
        {wellness && (
          <section style={{ background: 'var(--emerald-mist, #DCEDE5)', border: '0.5px solid var(--emerald-deep, #0A4D3C)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--emerald-deep, #0A4D3C)', marginBottom: 12 }}>
              Family Legacy Care
            </div>
            <div style={{ display: 'grid', gap: 16 }}>
              {wellness.upcomingAppointments.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Upcoming care</div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
                    {wellness.upcomingAppointments.slice(0, 3).map((a) => (
                      <li key={a.appointmentId}>{formatDate(a.scheduledAt)} · {a.providerName || a.appointmentKind || 'appointment'}</li>
                    ))}
                  </ul>
                </div>
              )}
              {wellness.financialSummaries.length > 0 && (() => {
                const s = wellness.financialSummaries[0];
                return (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Latest financial check-in</div>
                    <div style={{ fontSize: 13 }}>
                      Balance: {dollars(s.endingBalanceCents)}
                      {s.estimatedRunwayMonths != null && ` · ${s.estimatedRunwayMonths} months of runway`}
                    </div>
                    <div style={{ fontSize: 11, marginTop: 4, color: s.approvedByParent ? 'var(--emerald-deep, #0A4D3C)' : '#A23B2E' }}>
                      {s.approvedByParent ? 'Approved by Mom and Dad' : 'Waiting on Mom and Dad to review'}
                    </div>
                  </div>
                );
              })()}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
