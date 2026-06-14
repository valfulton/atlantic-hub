/**
 * /admin/av/clients/[client_id]/preview/cases/[caseId]  (val 2026-06-11, Phase 2)
 *
 * Operator preview mirror — val sees what Rebecca / parents see, with a
 * thin operator chrome banner at the top and a "Back to client" link.
 * Same data load + cream rendering as /client/cases/[caseId]; just
 * unwraps the client-session check.
 *
 * Per feedback_mirror_every_client_page — every /client/* surface ships
 * with this preview path so val can demo + QC without logging in as
 * the client.
 */
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { loadFullCase } from '@/lib/case/case_store';
import { loadFullWellness } from '@/lib/case/family_wellness';
import {
  resolveCaseViewerRole,
  visibleFor,
  listViewAsCandidates,
  type CaseViewerRole
} from '@/lib/case/case_collaborators';
import ViewAsPicker from '@/components/case/ViewAsPicker';
import OperatorPreviewChrome from '@/app/admin/av/clients/[client_id]/preview/_components/OperatorPreviewChrome';

/* (val 2026-06-13) Inline client-nav mockup. ClientV3TopNav's .v3-* CSS
   lives in /client/_styles/app.css which is only loaded by /client/layout.tsx;
   on /admin/* the classes render unstyled (giant logo, mashed nav links).
   Inline styles keep the mirror visually accurate without dragging the
   client design system into operator pages. */
function PreviewClientNav() {
  const NAV = ['Home', 'Matters', 'Leads', 'Watchlist', 'Campaigns', 'Calendar', 'Content', 'Press', 'Newsroom'];
  return (
    <div style={{
      background: '#FAF8F4',
      borderBottom: '1px solid rgba(10,77,60,0.10)',
      padding: '12px 22px',
      display: 'flex',
      alignItems: 'center',
      gap: 18,
      flexWrap: 'wrap',
      fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      <span style={{
        fontFamily: 'Fraunces, Georgia, serif',
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        color: '#14201B'
      }}>
        Atlantic &amp; Vine
      </span>
      <nav style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }} aria-label="What the client sees in their top nav">
        {NAV.map((label) => (
          <span
            key={label}
            style={{
              fontSize: 12,
              fontWeight: label === 'Matters' ? 600 : 500,
              color: label === 'Matters' ? '#0A4D3C' : '#5C6862',
              padding: '4px 2px',
              borderBottom: label === 'Matters' ? '2px solid #0A4D3C' : '2px solid transparent'
            }}
          >
            {label}
          </span>
        ))}
      </nav>
    </div>
  );
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * (val 2026-06-12) Cream-register tokens defined LOCALLY on the page wrapper.
 * The operator route's base theme defines --ink as near-white (#f1f5f9, for the
 * dark cockpit); without redefining the cream tokens here, the case body text
 * inherited that near-white --ink and rendered bone-on-cream (val's legibility
 * blocker on the preview mirror). Setting the cream palette on the container
 * makes every var(--ink/--muted/--paper/...) inside resolve to cream values,
 * independent of whichever theme the surrounding route applies.
 */
const CREAM_SKIN = {
  '--ink': '#14201B',
  '--muted': '#5C6862',
  '--paper': '#FFFFFF',
  '--cream': '#FAF8F4',
  '--gold-deep': '#7A5A18',
  '--emerald-deep': '#0A4D3C',
  '--emerald-mist': '#DCEDE5'
} as CSSProperties;

interface PageProps {
  params: { client_id: string; caseId: string };
  searchParams: { as?: string };
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
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

function dollars(cents: number | null): string {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default async function PreviewCasePage({ params, searchParams }: PageProps) {
  const clientId = parseInt(params.client_id, 10);
  const caseId = parseInt(params.caseId, 10);
  if (!Number.isInteger(clientId) || !Number.isInteger(caseId)) notFound();

  // (val 2026-06-13, #636) "View as" — read ?as=<client_user_id>. When set,
  // resolve that user's role on this case and apply the visibility filter so
  // the page renders EXACTLY what they would see. When absent, val is in
  // operator/god view and sees everything.
  const asParam = searchParams.as;
  const asUserId = asParam && /^\d+$/.test(asParam) ? parseInt(asParam, 10) : null;

  // Peek at the case's client_id BEFORE loading the action items so we can
  // resolve the viewer's role with the right brand context.
  const peek = await loadFullCase(caseId);
  if (!peek || peek.case.clientId !== clientId) notFound();

  let viewerRole: CaseViewerRole = 'operator';
  let visibilityFilter: ('parents_safe' | 'operator_only')[] | undefined = undefined;
  if (asUserId !== null) {
    viewerRole = await resolveCaseViewerRole(asUserId, caseId, peek.case.clientId);
    visibilityFilter = visibleFor(viewerRole);
  }

  // Now reload with the filter applied. Cheap — loadFullCase is already
  // batched and the second pass only swaps the action-items query.
  const full = (asUserId !== null)
    ? await loadFullCase(caseId, visibilityFilter)
    : peek;
  if (!full) notFound();

  const candidates = await listViewAsCandidates(caseId, full.case.clientId);

  const c = full.case;
  const wellness = c.wellnessEnabled ? await loadFullWellness(caseId) : null;
  const openActions = full.actionItems.filter((a) => a.status !== 'done');

  return (
    <>
      {/* (val 2026-06-13) Use the shared OperatorPreviewChrome — same banner +
          sibling tab strip every other preview surface uses. Replaces the inline
          ad-hoc banner that lived here. `active="cases"` highlights the Matters
          tab in the operator strip. */}
      <div style={{ padding: '0 18px' }}>
        <OperatorPreviewChrome
          clientId={clientId}
          clientName={c.caseName}
          active="cases"
          bannerExtra={
            <Link href={`/admin/av/clients/${clientId}/cases/${caseId}`} style={{ color: '#0A4D3C', textDecoration: 'none' }}>
              Operator case dashboard →
            </Link>
          }
        />
      </div>

      {/* (val 2026-06-13, #636) View-as picker — operator picks any collaborator
          to see the page filtered to what THAT user sees. Default (no ?as) =
          full operator visibility. */}
      <div style={{ padding: '0 18px' }}>
        <ViewAsPicker candidates={candidates} current={asUserId} />
      </div>

      {/* (val 2026-06-13) Inline client-nav mockup — see PreviewClientNav above. */}
      <PreviewClientNav />

      {/* Same content as /client/cases/[caseId] */}
      <main className="min-h-screen" style={{ ...CREAM_SKIN, background: 'var(--cream)', color: 'var(--ink)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1.25rem 4rem' }}>
          <div style={{ fontSize: 11, color: 'var(--muted, #3B4944)', marginBottom: 18 }}>
            <span style={{ color: 'var(--gold-deep, #7A5A18)' }}>Your matters</span>
            <span style={{ margin: '0 6px' }}>·</span>
            <span>{c.caseName}</span>
          </div>

          <header style={{ marginBottom: '2rem' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold-deep, #7A5A18)', marginBottom: 8 }}>
              {caseKindLabel(c.caseKind)}
            </div>
            <h1 style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontWeight: 500, fontSize: 36, lineHeight: 1.1, marginBottom: 10 }}>
              {c.caseName}
            </h1>
            <div style={{ fontSize: 12, color: 'var(--muted, #3B4944)' }}>
              Opened {formatDate(c.openedAt)}
              {c.metadata?.trust_executed_date ? ` · Trust executed ${String(c.metadata.trust_executed_date)}` : ''}
            </div>
          </header>

          {c.caseSynopsis && (
            <section style={{ background: 'var(--paper, #FFFFFF)', border: '0.5px solid rgba(10,10,10,0.1)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #3B4944)', marginBottom: 10 }}>Where we are</div>
              <div style={{ fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{c.caseSynopsis}</div>
            </section>
          )}

          {full.property && (
            <section style={{ background: 'var(--paper, #FFFFFF)', border: '0.5px solid rgba(10,10,10,0.1)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #3B4944)', marginBottom: 10 }}>The property</div>
              <div style={{ fontSize: 15, fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif' }}>{full.property.addressLine}</div>
              <div style={{ fontSize: 13, color: 'var(--muted, #3B4944)' }}>
                {[full.property.city, full.property.state, full.property.zip].filter(Boolean).join(', ')}
                {full.property.county ? ` · ${full.property.county} County` : ''}
              </div>
              {full.property.currentTitledOwner && (
                <div style={{ fontSize: 12, marginTop: 10 }}>
                  <span style={{ color: 'var(--muted, #3B4944)' }}>Currently titled to:</span> <strong>{full.property.currentTitledOwner}</strong>
                </div>
              )}
              {(full.property.estimatedValueCents != null || full.property.equityCents != null) && (
                <div style={{ display: 'flex', gap: 24, fontSize: 12, marginTop: 8 }}>
                  {full.property.estimatedValueCents != null && (
                    <div><span style={{ color: 'var(--muted, #3B4944)' }}>Est. value:</span> {dollars(full.property.estimatedValueCents)}</div>
                  )}
                  {full.property.equityCents != null && (
                    <div><span style={{ color: 'var(--muted, #3B4944)' }}>Equity:</span> {dollars(full.property.equityCents)}</div>
                  )}
                </div>
              )}
            </section>
          )}

          {openActions.length > 0 && (
            <section style={{ background: 'var(--paper, #FFFFFF)', border: '0.5px solid rgba(10,10,10,0.1)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #3B4944)', marginBottom: 12 }}>What we are working on next</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
                {openActions.map((a) => (
                  <li key={a.actionId} style={{ borderLeft: a.priority === 'urgent' ? '3px solid #A23B2E' : a.priority === 'high' ? '3px solid var(--gold-deep, #7A5A18)' : '3px solid rgba(10,10,10,0.15)', paddingLeft: 12 }}>
                    {/* (val 2026-06-12) Preview mirror must match the client
                        view: Open → link to action detail page, and the detail
                        text wraps on newlines via whiteSpace pre-wrap so the
                        Options A–E (or any long detail) renders as paragraphs
                        instead of one wall of text. */}
                    <Link
                      href={`/admin/av/clients/${clientId}/preview/cases/${caseId}/actions/${a.actionId}`}
                      style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', textDecoration: 'none', display: 'block' }}
                    >
                      {a.title}
                    </Link>
                    {a.detail && (
                      <div style={{ fontSize: 12, color: 'var(--muted, #3B4944)', marginTop: 4, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                        {a.detail}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: 'var(--muted, #3B4944)', marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span>{a.priority}</span>
                      {a.dueDate && <span>· due {formatDate(a.dueDate)}</span>}
                      <Link
                        href={`/admin/av/clients/${clientId}/preview/cases/${caseId}/actions/${a.actionId}`}
                        style={{ marginLeft: 'auto', color: 'var(--gold-deep, #7A5A18)', textDecoration: 'none' }}
                      >
                        Open →
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {full.events.length > 0 && (
            <section style={{ background: 'var(--paper, #FFFFFF)', border: '0.5px solid rgba(10,10,10,0.1)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #3B4944)', marginBottom: 12 }}>Timeline</div>
              <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 14 }}>
                {full.events.map((e) => (
                  <li key={e.eventId} style={{ borderLeft: '2px solid rgba(10,10,10,0.12)', paddingLeft: 14 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted, #3B4944)' }}>{formatDate(e.eventDate)}</div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{e.eventTitle}</div>
                    {e.eventDetail && <div style={{ fontSize: 12, color: 'var(--muted, #3B4944)', marginTop: 4, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{e.eventDetail}</div>}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* (val 2026-06-12, #613) Mirror of the client-view split:
              "Awaiting your decision" (pending_review, gold border) vs
              "Ready to download" (approved). Draft + rejected are operator-only
              so they're hidden on the preview just like they are on the
              real client view. The preview doesn't render Approve/Reject
              actions — those only exist on the actual /client route where
              Adriana is logged in. */}
          {(() => {
            const pending = full.documents.filter((d) => d.approvalStatus === 'pending_review');
            const approved = full.documents.filter((d) => d.approvalStatus === 'approved');
            return (
              <>
                {pending.length > 0 && (
                  <section style={{ background: 'var(--paper, #FFFFFF)', border: '1px solid var(--gold-deep, #7A5A18)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
                    <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold-deep, #7A5A18)', marginBottom: 4 }}>
                      Awaiting your decision
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted, #3B4944)', marginBottom: 14 }}>
                      Atlantic & Vine prepared these drafts. Review each one, then approve or send back with a note.
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
                      {pending.map((d) => (
                        <li key={d.documentId} style={{ borderLeft: '3px solid var(--gold-deep, #7A5A18)', paddingLeft: 14 }}>
                          <a
                            href={`/api/admin/av/cases/${c.caseId}/documents/${d.documentId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: 'var(--emerald-deep, #0A4D3C)',
                              fontWeight: 600,
                              textDecoration: 'underline',
                              textDecorationColor: 'rgba(10,77,60,0.3)',
                              textUnderlineOffset: 2,
                              fontSize: 14
                            }}
                          >
                            {d.documentName}
                          </a>
                          {d.documentKind && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--muted, #3B4944)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{d.documentKind}</span>}
                          {d.notes && (
                            <div style={{ fontSize: 12, color: 'var(--muted, #3B4944)', marginTop: 4, fontStyle: 'italic' }}>{d.notes}</div>
                          )}
                          <div style={{ fontSize: 11, color: 'var(--muted, #3B4944)', marginTop: 6, fontStyle: 'italic' }}>
                            (Approve / Send back buttons appear on the live client view — not in this read-only preview.)
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {approved.length > 0 && (
                  <section style={{ background: 'var(--paper, #FFFFFF)', border: '0.5px solid rgba(10,10,10,0.1)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
                    <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #3B4944)', marginBottom: 12 }}>Ready to download</div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
                      {approved.map((d) => (
                        <li key={d.documentId} style={{ fontSize: 13 }}>
                          <a
                            href={`/api/admin/av/cases/${c.caseId}/documents/${d.documentId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: 'var(--emerald-deep, #0A4D3C)',
                              fontWeight: 600,
                              textDecoration: 'underline',
                              textDecorationColor: 'rgba(10,77,60,0.3)',
                              textUnderlineOffset: 2
                            }}
                          >
                            {d.documentName}
                          </a>
                          {d.documentKind && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--muted, #3B4944)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{d.documentKind}</span>}
                          {d.approvalNote && (
                            <div style={{ fontSize: 11, color: 'var(--emerald-deep, #0A4D3C)', marginTop: 2, fontStyle: 'italic' }}>
                              Approved: {d.approvalNote}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            );
          })()}

          {full.parties.length > 0 && (
            <section style={{ background: 'var(--paper, #FFFFFF)', border: '0.5px solid rgba(10,10,10,0.1)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #3B4944)', marginBottom: 12 }}>On this matter</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
                {full.parties.map((p) => (
                  <li key={p.partyId} style={{ fontSize: 13 }}>
                    <strong>{p.fullName}</strong>
                    {p.role && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted, #3B4944)' }}>{p.role.replace(/_/g, ' ')}</span>}
                    {p.relationship && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted, #3B4944)', fontStyle: 'italic' }}>{p.relationship}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {wellness && (
            <section style={{ background: 'var(--emerald-mist, #DCEDE5)', border: '0.5px solid var(--emerald-deep, #0A4D3C)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--emerald-deep, #0A4D3C)', marginBottom: 12 }}>Family Legacy Care</div>
              {wellness.upcomingAppointments.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Upcoming care</div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13 }}>
                    {wellness.upcomingAppointments.slice(0, 3).map((a) => (
                      <li key={a.appointmentId}>{formatDate(a.scheduledAt)} · {a.providerName || a.appointmentKind || 'appointment'}</li>
                    ))}
                  </ul>
                </div>
              )}
              {wellness.financialSummaries.length === 0 && wellness.upcomingAppointments.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--emerald-deep, #0A4D3C)', fontStyle: 'italic' }}>
                  Wellness wrapper is on — health roster, appointments, and financial check-ins will appear here as the family records them.
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </>
  );
}
