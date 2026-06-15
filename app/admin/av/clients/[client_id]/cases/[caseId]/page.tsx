/**
 * /admin/av/clients/[client_id]/cases/[caseId]  (val 2026-06-11)
 *
 * Operator case dashboard. Anchored on the Johnson family Home-Ranch Trust
 * case but reusable for every client + every case_kind. Mounts seven panels:
 *
 *   1. Synopsis (editable summary)
 *   2. Timeline (case_events, chronological)
 *   3. Document vault (case_documents, grouped by kind)
 *   4. Property (case_property — auto-populated from recorder)
 *   5. Parties + roles (case_parties)
 *   6. Action items (case_action_items)
 *   7. Family wellness (mounts when cases.wellness_enabled = TRUE)
 *
 * Server-renders all data via lib/case/case_store.loadFullCase + the
 * wellness loader. Reads are pure; mutations are handled via API routes
 * (built in follow-on pass).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadFullCase, findIndexableDocumentForCase } from '@/lib/case/case_store';
import { caseAccessibleAsClient } from '@/lib/case/case_collaborators';
import { loadFullWellness } from '@/lib/case/family_wellness';
import { listCollaboratorsForCase } from '@/lib/case/case_collaborators';
import WellnessEditorPanel from '@/components/case/WellnessEditorPanel';
import DocumentVaultPanel from '@/components/case/DocumentVaultPanel';
import CollaboratorsPanel from '@/components/case/CollaboratorsPanel';
import SectionText from '@/components/case/SectionText';
import ActionItemsEditorPanel from '@/components/case/ActionItemsEditorPanel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { client_id: string; caseId: string };
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

function caseKindLabel(k: string): string {
  switch (k) {
    case 'trust_dispute': return 'Trust dispute';
    case 'elder_advocacy': return 'Elder advocacy';
    case 'estate_litigation': return 'Estate litigation';
    case 'malpractice_defense': return 'Malpractice defense';
    case 'campaign_legal': return 'Campaign legal';
    case 'guardianship': return 'Guardianship';
    case 'family_law': return 'Family law';
    case 'business_litigation': return 'Business litigation';
    case 'general_litigation':
    default:
      return 'General litigation';
  }
}

function priorityPill(p: string) {
  const styles: Record<string, string> = {
    urgent: 'bg-red-900/30 text-red-300 border-red-700/40',
    high: 'bg-amber-900/30 text-amber-300 border-amber-700/40',
    normal: 'bg-[var(--surface-3)] text-muted border-border',
    low: 'bg-[var(--surface-3)] text-muted border-border'
  };
  return styles[p] || styles.normal;
}

function statusPill(s: string) {
  const styles: Record<string, string> = {
    open: 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40',
    in_progress: 'bg-blue-900/30 text-blue-300 border-blue-700/40',
    done: 'bg-[var(--surface-3)] text-muted border-border',
    blocked: 'bg-red-900/30 text-red-300 border-red-700/40'
  };
  return styles[s] || styles.open;
}

function dollars(cents: number | null): string {
  if (cents == null) return '—';
  const dollars = cents / 100;
  return dollars.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default async function CaseDetailPage({ params }: PageProps) {
  const clientId = parseInt(params.client_id, 10);
  const caseId = parseInt(params.caseId, 10);
  if (!Number.isInteger(clientId) || !Number.isInteger(caseId)) notFound();

  const full = await loadFullCase(caseId);
  if (!full) notFound();
  // (val 2026-06-14, #659/#632) Operator case page mirrors the preview's
  // brand-scope rule: a case is reachable here if it's homed on this brand
  // OR a non-revoked collaborator row exists with via_client_id = this brand.
  // Johnson trust lives on AV Real Estate (client 13) but Adriana works it
  // through CLDA (10) via fcc.via_client_id=10. Without this, val 404s when
  // she clicks "Open the matter →" into the CLDA workspace.
  const accessible = await caseAccessibleAsClient(caseId, clientId, full.case.clientId);
  if (!accessible) notFound();

  const c = full.case;
  const [wellness, collaborators, indexableDoc] = await Promise.all([
    c.wellnessEnabled ? loadFullWellness(caseId) : Promise.resolve(null),
    listCollaboratorsForCase(caseId),
    findIndexableDocumentForCase(caseId)
  ]);
  // The byte-serve URL the SectionText renderer will deep-link into. Only
  // populated when there's an indexed trust/will/POA on this case.
  const sectionDocUrl = indexableDoc
    ? `/api/admin/av/cases/${c.caseId}/documents/${indexableDoc.documentId}`
    : null;
  const sectionIndex = indexableDoc?.sectionIndex ?? null;

  // (val 2026-06-14) Content div, not a main element — the shared operator
  // layout already renders main + the left Sidebar flex row. A nested
  // full-height main with a surface bg hid the sidebar on this new route.
  return (
    <div className="text-ink">
      <div className="max-w-6xl mx-auto">
        {/* Breadcrumb */}
        <div className="text-xs text-muted mb-4">
          <Link href="/admin/av/cases" className="hover:text-brand">Cases</Link>
          {' · '}
          <Link href={`/admin/av/clients/${clientId}`} className="hover:text-brand">Client #{clientId}</Link>
          {' · '}
          <span>{c.caseName}</span>
        </div>

        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-[11px] tracking-[0.18em] uppercase text-muted">
              {caseKindLabel(c.caseKind)}
            </span>
            <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border ${statusPill(c.status)}`}>
              {c.status}
            </span>
            {c.wellnessEnabled && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md border bg-emerald-900/30 text-emerald-300 border-emerald-700/40">
                Family wellness on
              </span>
            )}
          </div>
          <h1 className="text-3xl font-medium" style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif' }}>
            {c.caseName}
          </h1>
          <div className="text-xs text-muted mt-2">
            Opened {formatDate(c.openedAt)}
            {c.metadata?.trust_executed_date ? ` · Trust executed ${String(c.metadata.trust_executed_date)}` : ''}
            {c.metadata?.trust_county ? ` · ${String(c.metadata.trust_county)} County` : ''}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT — main column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Synopsis */}
            <section className="rounded-xl border border-border bg-[var(--surface-2)] p-5">
              <h2 className="text-sm uppercase tracking-wider text-muted mb-3">Synopsis</h2>
              <div className="text-sm whitespace-pre-wrap leading-relaxed">
                {c.caseSynopsis ? (
                  <SectionText
                    text={c.caseSynopsis}
                    documentUrl={sectionDocUrl}
                    sectionIndex={sectionIndex}
                  />
                ) : (
                  <span className="text-muted italic">No synopsis yet. Add one to give the family + counsel a single paragraph that captures the case.</span>
                )}
              </div>
            </section>

            {/* Timeline */}
            <section className="rounded-xl border border-border bg-[var(--surface-2)] p-5">
              <h2 className="text-sm uppercase tracking-wider text-muted mb-3">Timeline</h2>
              {full.events.length === 0 ? (
                <div className="text-sm text-muted italic">No events logged yet.</div>
              ) : (
                <ol className="space-y-3">
                  {full.events.map((e) => (
                    <li key={e.eventId} className="border-l-2 border-border pl-3">
                      <div className="text-xs text-muted">
                        {formatDate(e.eventDate)} {e.eventKind ? `· ${e.eventKind}` : ''}
                      </div>
                      <div className="font-medium text-sm">{e.eventTitle}</div>
                      {e.eventDetail && (
                        <div className="text-xs text-muted mt-1 whitespace-pre-wrap">
                          <SectionText
                            text={e.eventDetail}
                            documentUrl={sectionDocUrl}
                            sectionIndex={sectionIndex}
                          />
                        </div>
                      )}
                      {e.sourceUri && (
                        <a href={e.sourceUri} target="_blank" rel="noopener noreferrer" className="text-xs text-brand hover:underline">
                          source →
                        </a>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* Document vault — uploadable */}
            <DocumentVaultPanel
              caseId={c.caseId}
              documents={full.documents.map((d) => ({
                documentId: d.documentId,
                documentName: d.documentName,
                documentKind: d.documentKind,
                mimeType: d.mimeType,
                sizeBytes: d.sizeBytes,
                uploadedAt: d.uploadedAt,
                notes: d.notes,
                sectionCount: d.sectionIndex ? Object.keys(d.sectionIndex).length : null,
                // (#613) Approval status surfaced as a badge on each row.
                approvalStatus: d.approvalStatus,
                approvalNote: d.approvalNote
              }))}
            />

            {/* Family + advisors (collaborators) — invite Rebecca's siblings,
                Adriana as attorney, etc. Parent-approval gated per spec. */}
            <CollaboratorsPanel
              caseId={c.caseId}
              collaborators={collaborators.map((co) => ({
                collaboratorId: co.collaboratorId,
                clientUserId: co.clientUserId,
                email: co.email,
                displayName: co.displayName,
                role: co.role,
                invitationAccepted: co.invitationAccepted,
                acceptedAt: co.acceptedAt,
                parentApproved: co.parentApproved,
                revokedAt: co.revokedAt,
                magicToken: co.magicToken,
                magicTokenExpiresAt: co.magicTokenExpiresAt
              }))}
            />

            {/* Family wellness — mounts only when enabled */}
            {wellness && (
              <section className="rounded-xl border border-emerald-700/40 bg-emerald-900/10 p-5">
                <h2 className="text-sm uppercase tracking-wider text-emerald-300 mb-3">
                  Family Legacy Care
                </h2>

                {/* Health roster summary */}
                <div className="mb-4">
                  <h3 className="text-xs uppercase text-muted mb-2">Health roster ({wellness.healthRoster.length})</h3>
                  {wellness.healthRoster.length === 0 ? (
                    <div className="text-xs text-muted italic">Empty.</div>
                  ) : (
                    <ul className="text-sm space-y-1">
                      {wellness.healthRoster.slice(0, 5).map((h) => (
                        <li key={h.rosterId}>
                          <span className="text-xs uppercase text-muted mr-2">{h.category}</span>
                          {h.label}
                          {h.nextVisitDate && (
                            <span className="text-xs text-emerald-300 ml-2">next: {formatDate(h.nextVisitDate)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Upcoming appointments */}
                <div className="mb-4">
                  <h3 className="text-xs uppercase text-muted mb-2">
                    Upcoming appointments ({wellness.upcomingAppointments.length})
                  </h3>
                  {wellness.upcomingAppointments.length === 0 ? (
                    <div className="text-xs text-muted italic">None scheduled.</div>
                  ) : (
                    <ul className="text-sm space-y-1">
                      {wellness.upcomingAppointments.slice(0, 3).map((a) => (
                        <li key={a.appointmentId}>
                          <span className="text-xs text-emerald-300 mr-2">{formatDate(a.scheduledAt)}</span>
                          {a.providerName || a.appointmentKind || 'appointment'}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Financial summary */}
                <div className="mb-4">
                  <h3 className="text-xs uppercase text-muted mb-2">Latest financial summary</h3>
                  {wellness.financialSummaries.length === 0 ? (
                    <div className="text-xs text-muted italic">No summary yet.</div>
                  ) : (() => {
                    const s = wellness.financialSummaries[0];
                    return (
                      <div className="text-sm space-y-1">
                        <div>
                          <span className="text-xs uppercase text-muted mr-2">Balance:</span>
                          {dollars(s.endingBalanceCents)}
                        </div>
                        {s.estimatedRunwayMonths != null && (
                          <div>
                            <span className="text-xs uppercase text-muted mr-2">Runway:</span>
                            {s.estimatedRunwayMonths} months
                          </div>
                        )}
                        <div className="text-xs">
                          {s.approvedByParent ? (
                            <span className="text-emerald-300">Parent approved</span>
                          ) : (
                            <span className="text-amber-300">Waiting on parent approval</span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Recent meetings */}
                <div className="mb-4">
                  <h3 className="text-xs uppercase text-muted mb-2">
                    Recent housekeeping meetings ({wellness.meetingNotes.length})
                  </h3>
                  {wellness.meetingNotes.length === 0 ? (
                    <div className="text-xs text-muted italic">No meetings yet.</div>
                  ) : (
                    <ul className="text-sm space-y-1">
                      {wellness.meetingNotes.slice(0, 3).map((m) => (
                        <li key={m.meetingId}>
                          <span className="text-xs text-emerald-300 mr-2">{formatDate(m.meetingDate)}</span>
                          {m.meetingKind || 'meeting'}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Wellness checks with concerns */}
                {(() => {
                  const concerning = wellness.recentWellnessChecks.filter(
                    (w) => w.concerns || w.unusualContactsNote
                  );
                  if (!concerning.length) return null;
                  return (
                    <div className="rounded-md border border-amber-700/40 bg-amber-900/10 p-3">
                      <h3 className="text-xs uppercase text-amber-300 mb-2">
                        Wellness flags ({concerning.length})
                      </h3>
                      <ul className="text-sm space-y-2">
                        {concerning.slice(0, 3).map((w) => (
                          <li key={w.checkId}>
                            <div className="text-xs text-muted">{formatDate(w.observedAt)}</div>
                            {w.concerns && <div>{w.concerns}</div>}
                            {w.unusualContactsNote && (
                              <div className="text-amber-300 text-xs mt-1">
                                Unusual contact: {w.unusualContactsNote}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

                {/* Editable add forms (Phase 3) */}
                <WellnessEditorPanel
                  caseId={c.caseId}
                  parties={full.parties.map((p) => ({
                    partyId: p.partyId,
                    fullName: p.fullName,
                    isParent: p.isParent
                  }))}
                />
              </section>
            )}
          </div>

          {/* RIGHT — sidebar */}
          <aside className="space-y-6">
            {/* Property */}
            {full.property && (
              <section className="rounded-xl border border-border bg-[var(--surface-2)] p-5">
                <h2 className="text-sm uppercase tracking-wider text-muted mb-3">Property</h2>
                <div className="text-sm space-y-1">
                  {full.property.addressLine && (
                    <div className="font-medium">{full.property.addressLine}</div>
                  )}
                  <div className="text-muted">
                    {[full.property.city, full.property.state, full.property.zip].filter(Boolean).join(', ')}
                  </div>
                  {full.property.county && (
                    <div className="text-xs text-muted">{full.property.county} County</div>
                  )}
                  {full.property.currentTitledOwner && (
                    <div className="text-xs mt-2">
                      <span className="text-muted uppercase">Owner:</span>{' '}
                      {full.property.currentTitledOwner}
                    </div>
                  )}
                  {full.property.estimatedValueCents != null && (
                    <div className="text-xs">
                      <span className="text-muted uppercase">Est. value:</span>{' '}
                      {dollars(full.property.estimatedValueCents)}
                    </div>
                  )}
                  {full.property.equityCents != null && (
                    <div className="text-xs">
                      <span className="text-muted uppercase">Equity:</span>{' '}
                      {dollars(full.property.equityCents)}
                    </div>
                  )}
                  {full.property.lastRecorderPullAt && (
                    <div className="text-xs text-muted mt-2">
                      Last recorder pull: {formatDate(full.property.lastRecorderPullAt)}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Parties */}
            <section className="rounded-xl border border-border bg-[var(--surface-2)] p-5">
              <h2 className="text-sm uppercase tracking-wider text-muted mb-3">
                Parties ({full.parties.length})
              </h2>
              {full.parties.length === 0 ? (
                <div className="text-sm text-muted italic">No parties added.</div>
              ) : (
                <ul className="space-y-2 text-sm">
                  {full.parties.map((p) => (
                    <li key={p.partyId}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium">{p.fullName}</div>
                        <div className="flex items-center gap-1">
                          {p.isParent && (
                            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-emerald-700/40 text-emerald-300">
                              Parent
                            </span>
                          )}
                          {p.isVeteran && (
                            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-blue-700/40 text-blue-300">
                              Veteran
                            </span>
                          )}
                        </div>
                      </div>
                      {p.role && (
                        <div className="text-xs text-muted">{p.role}</div>
                      )}
                      {p.relationship && (
                        <div className="text-xs text-muted italic">{p.relationship}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Action items — editable since #632 (val 2026-06-14).
                Replaces the SQL workflow val was running to rewrite Options
                A–E on the Johnson trust matter. Inline edit/add/delete with
                visibility toggle (parents_safe vs operator_only). */}
            <section className="rounded-xl border border-border bg-[var(--surface-2)] p-5">
              <h2 className="text-sm uppercase tracking-wider text-muted mb-3">
                Action items
              </h2>
              <ActionItemsEditorPanel
                caseId={c.caseId}
                initialItems={full.actionItems}
              />
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
