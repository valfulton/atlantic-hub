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
import type { CSSProperties } from 'react';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getClientAccessState } from '@/lib/av/client_access';
import AccessPaused from '@/app/client/_components/AccessPaused';
import { loadFullCase, canClientUserAccessCase, findIndexableDocumentForCase, type CaseParty } from '@/lib/case/case_store';
import { resolveCaseViewerRole, visibleFor, listCollaboratorsForCase } from '@/lib/case/case_collaborators';
import { loadFullWellness } from '@/lib/case/family_wellness';
import SectionText from '@/components/case/SectionText';
import ActionItemDetail, { buildOptionDocsMap } from '@/components/case/ActionItemDetail';
import DocumentApprovalActions from '@/components/case/DocumentApprovalActions';
import FamilyFindingsPanel from '@/components/case/FamilyFindingsPanel';
import { listFamilyVisibleFindingsForCase } from '@/lib/case/document_findings_store';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * (val 2026-06-12) Cream-register tokens defined locally so the case body text
 * resolves to emerald-black on cream regardless of the surrounding theme — the
 * same guard the operator preview mirror needs (where the dark cockpit's --ink
 * is near-white). Keeps both surfaces self-contained and legible.
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

/**
 * Parse a synopsis body for rendering as a two-column document.
 *   (val 2026-06-14, #661 — UX/UI v4)
 *
 * HARD RULE: Content is verbatim. We never rewrite, summarize, soften, or
 * truncate. We only honor markers the operator wrote into the synopsis:
 *
 *   - `\n\n` separates paragraphs of prose.
 *   - `[STATUS]…[/STATUS]` wraps a sentence that should render as a thin
 *     garnet-rule callout (urgent matter status). Per the mock: "Cecilia
 *     is currently moving to force the sale of the home…" — set off
 *     visually, not paraphrased.
 *
 * Output preserves prose order so the renderer can map 1:1.
 */
type SynopsisBlock =
  | { kind: 'prose'; text: string }
  | { kind: 'status'; text: string };

function parseSynopsis(text: string | null | undefined): SynopsisBlock[] {
  if (!text) return [];
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  // If no explicit breaks, treat the whole text as one prose paragraph —
  // do NOT auto-split sentences. Operator controls breaks.
  return paras.map<SynopsisBlock>((p) => {
    const m = p.match(/^\[STATUS\]([\s\S]*?)\[\/STATUS\]$/);
    if (m) return { kind: 'status', text: m[1].trim() };
    return { kind: 'prose', text: p };
  });
}

/**
 * Group case_parties into the document-style sidebar buckets.
 *   (val 2026-06-15, #664)
 * Buckets: Trustors → Trustees → Successor trustees → Beneficiaries → Other.
 *
 * ORDER MATTERS: 'successor_trustee' contains 'trustee', so the successor
 * check MUST run before the plain trustee check. Rebecca (successor) was
 * being mis-bucketed with Cecilia (current trustee) until we caught this.
 */
function groupParties(parties: CaseParty[]): Array<{ label: string; members: CaseParty[] }> {
  const buckets: Record<string, CaseParty[]> = {
    Trustors: [],
    Trustees: [],
    'Successor trustees': [],
    Beneficiaries: [],
    Other: []
  };
  for (const p of parties) {
    const r = (p.role || '').toLowerCase();
    if (r.includes('trustor') || r.includes('settlor') || r.includes('grantor')) buckets.Trustors.push(p);
    else if (r.includes('successor')) buckets['Successor trustees'].push(p);
    else if (r.includes('trustee')) buckets.Trustees.push(p);
    else if (r.includes('beneficiary')) buckets.Beneficiaries.push(p);
    else buckets.Other.push(p);
  }
  return (['Trustors', 'Trustees', 'Successor trustees', 'Beneficiaries', 'Other'] as const)
    .map((label) => ({ label, members: buckets[label] }))
    .filter((g) => g.members.length > 0);
}

/**
 * Family-facing role label.  (val 2026-06-14, #661 HARD RULE 2)
 *
 * The DB stores `attorney` / `advisor` for legal collaborators. On any
 * client-facing surface we MUST remap to "Legal Document Assistant" —
 * never the word "attorney" or "lawyer" anywhere. This is a compliance
 * line, not a style choice. Other role labels render human-readable.
 */
function familyFacingRoleLabel(dbRole: string | null | undefined): string {
  switch ((dbRole || '').toLowerCase()) {
    case 'attorney':
    case 'advisor':
      return 'Legal Document Assistant';
    case 'sibling_admin':
      return 'Account representative';
    case 'sibling_commenter':
      return 'Family';
    case 'sibling_reader':
      return 'Family';
    case 'primary_caregiver':
      return 'Primary caregiver';
    case 'successor_trustee':
      return 'Successor trustee';
    case 'parent':
      return 'Parent';
    default:
      return (dbRole || '').replace(/_/g, ' ');
  }
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

  // Peek once to get the case's owning client_id so the role resolver has
  // the right brand context. Then reload with the visibility filter applied.
  const peek = await loadFullCase(caseId);
  if (!peek) notFound();

  // Critical: prevent IDOR. Access granted if EITHER:
  //   - the case belongs to this user's primary client_id, OR
  //   - the user is an approved, non-revoked collaborator on this case.
  // The latter is how Adriana (attorney on Johnson) reads the matter from
  // inside her own CBB portal.
  const canAccess =
    peek.case.clientId === clientId
    || await canClientUserAccessCase(actor.clientUserId, clientId, caseId);
  if (!canAccess) notFound();

  // (val 2026-06-13, #635) Resolve the LIVE viewer's role on this case and
  // reload with their visibility filter. Parents see parents_safe only;
  // Rebecca (sibling_admin = account_rep) sees everything; Adriana
  // (attorney = professional) sees parents_safe only.
  const viewerRole = await resolveCaseViewerRole(
    actor.clientUserId,
    caseId,
    peek.case.clientId
  );
  const visibilityFilter = visibleFor(viewerRole);
  const full = await loadFullCase(caseId, visibilityFilter);
  if (!full) notFound();

  const c = full.case;
  // (val 2026-06-15, #667) Reviewers — non-revoked attorney/advisor
  // collaborators, deduped by displayName first (then email, then
  // clientUserId). Name-first because the same human commonly has a
  // brand-specific email per client (Adriana: cbb-* and clda-*) so
  // email-key dedupe missed. Names are durable across brand setups.
  const collaborators = await listCollaboratorsForCase(caseId);
  const seenReviewerKeys = new Set<string>();
  const reviewers = collaborators
    .filter((c2) => !c2.revokedAt && (c2.role === 'attorney' || c2.role === 'advisor'))
    .filter((c2) => {
      const name = c2.displayName?.trim().toLowerCase();
      const email = c2.email?.trim().toLowerCase();
      const key = name ? `n:${name}` : email ? `e:${email}` : `u:${c2.clientUserId}`;
      if (seenReviewerKeys.has(key)) return false;
      seenReviewerKeys.add(key);
      return true;
    });

  const [wellness, indexableDoc, familyFindings] = await Promise.all([
    c.wellnessEnabled ? loadFullWellness(caseId) : Promise.resolve(null),
    findIndexableDocumentForCase(caseId),
    listFamilyVisibleFindingsForCase(caseId)
  ]);

  // (#669) Pick the lead document reviewer for attribution. Adriana =
  // 'attorney' role (label is HARD-RULE remapped client-side). Falls back
  // to nothing if no reviewer is on the case yet.
  const docReviewer = reviewers.find(r => /attorney|legal/i.test(r.role || '')) || null;

  // Client byte-serve URL for the indexed trust/will/POA. Note this points at
  // the operator API — clients reading their own case will need a client-side
  // serve route in a follow-up (the link still opens in a new tab and the
  // operator route gates on guard.actor.userId, which client_user has). For
  // collaborators (e.g. Adriana attorney-side), this works today.
  const sectionDocUrl = indexableDoc
    ? `/api/admin/av/cases/${c.caseId}/documents/${indexableDoc.documentId}`
    : null;
  const sectionIndex = indexableDoc?.sectionIndex ?? null;

  // Show only OPEN/IN-PROGRESS action items to clients; completed live in archive
  const openActions = full.actionItems.filter((a) => a.status !== 'done');

  // (val 2026-06-14, #662) Split documents BEFORE the layout so we can route
  // approved → sidebar Documents panel and pending → main column action area.
  // Pending docs have interactive Approve/Reject buttons; approved are simple
  // download links and belong in the right rail.
  const pendingDocs = full.documents.filter((d) => d.approvalStatus === 'pending_review');
  const approvedDocs = full.documents.filter((d) => d.approvalStatus === 'approved');

  // (val 2026-06-15, #665) Option letter (A/B/C/D/E) → draft document map.
  // Scans ALL non-rejected docs (drafts visible in "Awaiting your decision"
  // are linkable too — the family clicks "A —" in the action item and
  // jumps to Option A's draft PDF). Universal: any case whose docs follow
  // the "Option_<A-E>_…" name pattern works.
  const linkableDocs = full.documents.filter((d) => d.approvalStatus !== 'rejected');
  const optionDocs = buildOptionDocsMap(linkableDocs);

  return (
    <>
      {/* (val 2026-06-13) Mount ClientV3TopNav so logged-in clients
          (Rebecca, Adriana, parents) have a working nav bar on the case
          detail page. Without this, desktop users had NO way to navigate
          between Home / Matters / Leads / etc. — they were stuck on
          whatever case page they landed on. */}
      <ClientV3TopNav />
    <main className="min-h-screen" style={{ ...CREAM_SKIN, background: 'var(--cream)', color: 'var(--ink)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1.25rem 4rem' }}>
        {/* Breadcrumb */}
        <div style={{ fontSize: 11, color: 'var(--muted, #3B4944)', marginBottom: 18 }}>
          <Link href="/client/cases" style={{ color: 'var(--gold-deep, #7A5A18)' }}>Your matters</Link>
          <span style={{ margin: '0 6px' }}>·</span>
          <span>{c.caseName}</span>
        </div>

        {/* Header band (val 2026-06-14, #661 v4) — eyebrow + Fraunces title +
            meta + status badges. "Open" pill if case.status === 'open';
            "Time-sensitive" pill if metadata.time_sensitive === true (val sets
            this per-case). */}
        <header style={{ borderBottom: '1px solid rgba(10,77,60,0.14)', paddingBottom: 22, marginBottom: 30 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--gold-deep, #7A5A18)', marginBottom: 9 }}>
            {caseKindLabel(c.caseKind)}{full.property?.county ? ` · ${full.property.county} County` : ''}
          </div>
          <h1 style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontWeight: 500, fontSize: 33, lineHeight: 1.12, letterSpacing: '-0.012em', margin: '0 0 10px', color: 'var(--ink)' }}>
            {c.caseName}
          </h1>
          <p style={{ fontSize: 14.5, color: 'var(--muted, #5C6862)', margin: '0 0 14px' }}>
            Opened {formatDate(c.openedAt)}
            {c.metadata?.trust_executed_date ? ` · Trust executed ${String(c.metadata.trust_executed_date)}` : ''}
          </p>
          {/* Status markers — only render when there's something meaningful to
              communicate. The case being "open" is implied by viewing it
              (val 2026-06-15) — we don't show an "Open" pill on its own.
              "Closed" surfaces when c.status === 'closed' (rare on family
              view), and "Time-sensitive" surfaces when operator flags it. */}
          {(c.status === 'closed' || c.metadata?.time_sensitive === true) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {c.status === 'closed' && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, padding: '5px 12px', borderRadius: 6, color: 'var(--muted, #5C6862)', background: 'rgba(10,10,10,0.04)', border: '1px solid rgba(10,10,10,0.12)' }}>
                  Closed
                </span>
              )}
              {c.metadata?.time_sensitive === true && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, padding: '5px 12px', borderRadius: 6, color: '#8E2A2A', background: 'rgba(142,42,42,0.07)', border: '1px solid rgba(142,42,42,0.3)' }}>
                  <span aria-hidden="true">▲</span>
                  Time-sensitive
                </span>
              )}
            </div>
          )}
        </header>

        {/* Two-column body (val 2026-06-14, #661 v4 — UX/UI approved mock).
            Main column: Summary (verbatim per HARD RULE 1) + Outstanding items.
            Sidebar: Property · Parties · Trust provisions · Review & approval.
            Sidebar stacks under the main column on mobile. */}
        <div className="case-grid">
          <style>{`
            .case-grid { display: grid; grid-template-columns: 1fr 300px; gap: 40px; align-items: start; }
            .case-grid h2.case-h { font-family: 'Fraunces','Cormorant Garamond',Georgia,serif; font-weight: 500; font-size: 1.32rem; color: var(--ink); margin: 0 0 14px; padding-bottom: 9px; border-bottom: 1px solid rgba(10,77,60,0.14); }
            .case-grid .prose-p { font-size: 17px; line-height: 1.74; color: var(--ink); margin: 0 0 14px; }
            .case-grid .prose-p:last-child { margin-bottom: 0; }
            .case-grid .status-flag { border-left: 3px solid #8E2A2A; padding: 2px 0 2px 16px; margin: 16px 0; }
            .case-grid .status-flag .fe { font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #8E2A2A; margin: 0 0 3px; }
            .case-grid .status-flag p { font-size: 17px; line-height: 1.6; color: var(--ink); margin: 0; }
            .case-grid .ai-item { padding: 16px 0; border-top: 1px solid rgba(10,77,60,0.14); }
            .case-grid .ai-item:first-of-type { border-top: none; }
            .case-grid .ai-top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
            .case-grid .ai-num { font-family: 'Fraunces',Georgia,serif; font-size: 14px; color: var(--muted, #5C6862); }
            .case-grid .ai-tag { font-size: 10.5px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; padding: 2px 8px; border-radius: 5px; }
            .case-grid .ai-tag.urg { color: #8E2A2A; background: rgba(142,42,42,0.09); }
            .case-grid .ai-tag.hi { color: var(--gold-deep, #7A5A18); background: rgba(201,169,97,0.16); }
            .case-grid .ai-tag.norm { color: var(--emerald-deep, #0A4D3C); background: var(--emerald-mist, #EDF4F0); }
            .case-grid .ai-title { font-size: 17px; font-weight: 600; color: var(--ink); line-height: 1.4; text-decoration: none; display: block; }
            .case-grid .ai-title:hover { text-decoration: underline; text-decoration-color: rgba(10,77,60,0.3); text-underline-offset: 3px; }
            .case-grid .ai-detail { font-size: 15.5px; line-height: 1.62; color: var(--muted, #5C6862); margin-top: 5px; white-space: pre-wrap; }
            .case-grid .panel { background: var(--paper, #FFFFFF); border: 1px solid rgba(10,77,60,0.14); border-radius: 12px; padding: 18px 20px; margin-bottom: 18px; }
            .case-grid .panel-h { font-size: 11.5px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--emerald-deep, #0A4D3C); margin: 0 0 14px; }
            .case-grid .addr { font-family: 'Fraunces',Georgia,serif; font-weight: 500; font-size: 1.05rem; color: var(--ink); line-height: 1.25; }
            .case-grid .addr-line { font-size: 14px; color: var(--muted, #5C6862); margin-top: 4px; line-height: 1.45; }
            .case-grid .addr-title { font-size: 13.5px; margin-top: 10px; color: var(--muted, #5C6862); line-height: 1.45; }
            .case-grid .addr-title b { color: var(--ink); font-weight: 600; }
            .case-grid .party-grp { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--gold-deep, #7A5A18); margin: 14px 0 4px; }
            .case-grid .party-grp:first-child { margin-top: 0; }
            .case-grid .party { padding: 9px 0; border-top: 1px solid rgba(10,77,60,0.14); }
            .case-grid .party:first-of-type { border-top: none; padding-top: 0; }
            .case-grid .party-name { font-size: 15px; font-weight: 600; color: var(--ink); line-height: 1.25; }
            .case-grid .party-role { font-size: 13px; color: var(--muted, #5C6862); }
            .case-grid .prov { padding: 10px 0; border-top: 1px solid rgba(10,77,60,0.14); display: flex; gap: 10px; }
            .case-grid .prov:first-of-type { border-top: none; padding-top: 0; }
            .case-grid .prov a { font-family: 'Fraunces',Georgia,serif; font-size: 13px; font-weight: 600; color: var(--emerald-deep, #0A4D3C); text-decoration: none; flex: 0 0 auto; border-bottom: 1px solid rgba(10,77,60,0.3); }
            .case-grid .prov span { font-size: 14px; line-height: 1.45; color: var(--ink); }
            .case-grid .prep-name { font-size: 15px; font-weight: 600; color: var(--ink); }
            .case-grid .prep-role { font-size: 13.5px; color: var(--muted, #5C6862); margin-top: 2px; }
            .case-grid .prep-date { font-size: 13px; color: var(--muted, #5C6862); margin-top: 8px; line-height: 1.5; }
            .case-grid .doc-row { padding: 9px 0; border-top: 1px solid rgba(10,77,60,0.14); }
            .case-grid .doc-row:first-of-type { border-top: none; padding-top: 0; }
            .case-grid .doc-row a { font-size: 13.5px; font-weight: 600; color: var(--emerald-deep, #0A4D3C); text-decoration: underline; text-decoration-color: rgba(10,77,60,0.35); text-underline-offset: 2px; line-height: 1.35; display: inline-block; }
            .case-grid .doc-row a:hover { text-decoration-color: var(--emerald-deep, #0A4D3C); }
            .case-grid .doc-kind { font-size: 10px; color: var(--muted, #5C6862); text-transform: uppercase; letter-spacing: 0.1em; margin-top: 2px; }
            .case-grid .ai-collapse summary { cursor: pointer; list-style: none; }
            .case-grid .ai-collapse summary::-webkit-details-marker { display: none; }
            .case-grid .ai-collapse summary::marker { display: none; }
            .case-grid .ai-chev { font-size: 11px; color: var(--muted, #5C6862); transition: transform 0.18s ease; display: inline-block; transform-origin: center; }
            .case-grid .ai-collapse[open] .ai-chev { transform: rotate(90deg); }
            @media (max-width: 760px) { .case-grid { grid-template-columns: 1fr; gap: 30px; } }
          `}</style>

          {/* MAIN COLUMN */}
          <div>
            {c.caseSynopsis && (() => {
              const blocks = parseSynopsis(c.caseSynopsis);
              return (
                <div style={{ marginBottom: 30 }}>
                  <h2 className="case-h">Summary</h2>
                  {blocks.map((b, i) => (
                    b.kind === 'status' ? (
                      <div key={i} className="status-flag">
                        <p className="fe">Status</p>
                        <p>
                          <SectionText text={b.text} documentUrl={sectionDocUrl} sectionIndex={sectionIndex} />
                        </p>
                      </div>
                    ) : (
                      <p key={i} className="prose-p">
                        <SectionText text={b.text} documentUrl={sectionDocUrl} sectionIndex={sectionIndex} />
                      </p>
                    )
                  ))}
                </div>
              );
            })()}

            {openActions.length > 0 && (
              <div style={{ marginBottom: 30 }}>
                <h2 className="case-h">Outstanding items</h2>
                {openActions.map((a, i) => {
                  const tagClass = a.priority === 'urgent' ? 'urg' : a.priority === 'high' ? 'hi' : 'norm';
                  const tagLabel = a.priority === 'urgent' ? 'Urgent' : a.priority === 'high' ? 'High' : 'Normal';
                  // (val 2026-06-15, #662) Native <details>/<summary> for
                  // collapse — server-renderable, no JS needed, full a11y.
                  // Default OPEN so first-time readers see everything; each
                  // can be clicked to collapse and shorten the page.
                  return (
                    <details key={a.actionId} className="ai-item ai-collapse" open>
                      <summary>
                        <div className="ai-top">
                          <span className="ai-chev" aria-hidden="true">▸</span>
                          <span className="ai-num">{i + 1}</span>
                          <span className={`ai-tag ${tagClass}`}>{tagLabel}</span>
                          {a.dueDate && (
                            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted, #5C6862)' }}>
                              Due {formatDate(a.dueDate)}
                            </span>
                          )}
                        </div>
                        <Link href={`/client/cases/${caseId}/actions/${a.actionId}`} className="ai-title">
                          {a.title}
                        </Link>
                      </summary>
                      {a.detail && (
                        <div className="ai-detail">
                          <ActionItemDetail
                            text={a.detail}
                            documentUrl={sectionDocUrl}
                            sectionIndex={sectionIndex}
                            optionDocs={optionDocs}
                            caseId={c.caseId}
                            viewerUrlForDocument={(documentId) =>
                              `/client/cases/${c.caseId}/documents/${documentId}/view`
                            }
                          />
                        </div>
                      )}
                    </details>
                  );
                })}
              </div>
            )}

            {/* (val 2026-06-15, #669) Document findings the operator
                flipped to family_visible. Stealth attribution to the
                reviewer (Adriana = Legal Document Assistant). Panel
                hides itself when no family-visible findings exist. */}
            <FamilyFindingsPanel
              findings={familyFindings}
              documents={full.documents.map((d) => ({
                documentId: d.documentId,
                documentName: d.documentName,
                documentKind: d.documentKind
              }))}
              reviewerName={docReviewer?.displayName || null}
              reviewedAt={null}
              indexableDocumentUrl={sectionDocUrl}
              indexableDocumentId={indexableDoc?.documentId ?? null}
            />
          </div>

          {/* SIDEBAR */}
          <aside>
            {full.property && (
              <div className="panel">
                <p className="panel-h">Property</p>
                <div className="addr">{full.property.addressLine}</div>
                <div className="addr-line">
                  {[full.property.city, full.property.state, full.property.zip].filter(Boolean).join(', ')}
                  {full.property.county ? <><br />{full.property.county} County</> : null}
                </div>
                {full.property.currentTitledOwner && (
                  <div className="addr-title">
                    Titled to: <b>{full.property.currentTitledOwner}</b>
                  </div>
                )}
              </div>
            )}

            {full.parties.length > 0 && (() => {
              const groups = groupParties(full.parties);
              return (
                <div className="panel">
                  <p className="panel-h">Parties</p>
                  {groups.map((g) => (
                    <div key={g.label}>
                      <p className="party-grp">{g.label}</p>
                      {g.members.map((p) => (
                        <div key={p.partyId} className="party">
                          <div className="party-name">{p.fullName}</div>
                          {(p.relationship || p.role) && (
                            <div className="party-role">
                              {p.relationship || (p.role ? p.role.replace(/_/g, ' ') : '')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Trust provisions — render only if operator populated
                case.metadata.trust_provisions as Array<{section_key, description}>. */}
            {(() => {
              const tp = c.metadata?.trust_provisions;
              if (!Array.isArray(tp) || tp.length === 0) return null;
              return (
                <div className="panel">
                  <p className="panel-h">Trust provisions</p>
                  {tp.map((p, i) => {
                    const item = p as { section_key?: string; description?: string };
                    if (!item.section_key) return null;
                    const page = sectionIndex?.[item.section_key]
                      ?? sectionIndex?.[item.section_key.replace(/\(\d+\)$/, '')];
                    const href = page && sectionDocUrl ? `${sectionDocUrl}#page=${page}` : undefined;
                    return (
                      <div key={i} className="prov">
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer">§{item.section_key}</a>
                        ) : (
                          <span style={{ fontFamily: 'Fraunces,Georgia,serif', fontSize: 13, fontWeight: 600, color: 'var(--emerald-deep, #0A4D3C)', flex: '0 0 auto' }}>§{item.section_key}</span>
                        )}
                        <span>{item.description || ''}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Review & approval — Adriana (HARD RULE 2: NEVER "attorney"
                or "lawyer" on a family surface; HARD RULE 3: framed as
                REVIEWER, not author). Operator can override the org label
                via case.metadata.reviewer_org_label; otherwise fall back to
                "Legal services". */}
            {reviewers.length > 0 && (() => {
              const orgLabel = typeof c.metadata?.reviewer_org_label === 'string'
                ? String(c.metadata.reviewer_org_label)
                : 'Legal services';
              const blurb = typeof c.metadata?.reviewer_blurb === 'string'
                ? String(c.metadata.reviewer_blurb)
                : 'Reviews and approves new documents for this matter.';
              return (
                <div className="panel">
                  <p className="panel-h">Review &amp; approval</p>
                  {reviewers.map((r) => (
                    <div key={r.collaboratorId} style={{ marginBottom: 12 }}>
                      <div className="prep-name">{r.displayName || r.email}</div>
                      <div className="prep-role">{orgLabel} · {familyFacingRoleLabel(r.role)}</div>
                    </div>
                  ))}
                  <div className="prep-date">{blurb}</div>
                </div>
              );
            })()}

            {/* Documents — approved/downloadable docs only (val 2026-06-15, #662).
                Pending docs with Approve/Reject controls stay in the main column
                below the two-column body so the interactive surface is prominent. */}
            {approvedDocs.length > 0 && (
              <div className="panel">
                <p className="panel-h">Documents</p>
                {approvedDocs.map((d) => (
                  <div key={d.documentId} className="doc-row">
                    {/* (#675) Viewer page — renders .md / .pdf / image inline.
                        Safari was force-downloading .md when this pointed at the
                        byte-serve endpoint. */}
                    <a
                      href={`/client/cases/${c.caseId}/documents/${d.documentId}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {d.documentName}
                    </a>
                    {d.documentKind && (
                      <div className="doc-kind">{d.documentKind}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>

        {/* Timeline */}
        {full.events.length > 0 && (
          <section style={{ background: 'var(--paper, #FFFFFF)', border: '0.5px solid rgba(10,10,10,0.1)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #3B4944)', marginBottom: 12 }}>
              Timeline
            </div>
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 14 }}>
              {full.events.map((e) => (
                <li key={e.eventId} style={{ borderLeft: '2px solid rgba(10,10,10,0.12)', paddingLeft: 14 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted, #3B4944)' }}>{formatDate(e.eventDate)}</div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{e.eventTitle}</div>
                  {e.eventDetail && (
                    <div style={{ fontSize: 12, color: 'var(--muted, #3B4944)', marginTop: 4, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                      <SectionText
                        text={e.eventDetail}
                        documentUrl={sectionDocUrl}
                        sectionIndex={sectionIndex}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Document vault — split by approval status (val 2026-06-12, #613).
            Pending drafts go to "Awaiting your decision" with Approve/Reject
            buttons (Adriana acts here). Approved docs go to "Ready to download"
            with a clickable filename. Draft (operator-still-editing) + rejected
            docs are hidden from clients per spec — operator sees them on her
            dashboard. */}
        {/* (val 2026-06-15, #662) Approved/downloadable docs moved into the
            sidebar Documents panel. Pending docs (with Approve/Reject) stay
            below the two-column area because they have interactive controls
            Adriana acts on — they belong in the main flow. */}
        {pendingDocs.length > 0 && (
          <section style={{ background: 'var(--paper, #FFFFFF)', border: '1px solid var(--gold-deep, #7A5A18)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold-deep, #7A5A18)', marginBottom: 4 }}>
              Awaiting your decision
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted, #3B4944)', marginBottom: 14 }}>
              Drafts are ready for your review. Approve each one, or send it back with a note.
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 16 }}>
              {pendingDocs.map((d) => (
                <li key={d.documentId} style={{ borderLeft: '3px solid var(--gold-deep, #7A5A18)', paddingLeft: 14 }}>
                  {/* (#675) Viewer page — renders .md / .pdf / image inline.
                      The Option A-E drafts that prompted the build are markdown,
                      and Safari was downloading them when this pointed at the
                      byte-serve route. */}
                  <a
                    href={`/client/cases/${c.caseId}/documents/${d.documentId}/view`}
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
                  {d.documentKind && (
                    <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--muted, #3B4944)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{d.documentKind}</span>
                  )}
                  {d.notes && (
                    <div style={{ fontSize: 12, color: 'var(--muted, #3B4944)', marginTop: 4, fontStyle: 'italic' }}>{d.notes}</div>
                  )}
                  <DocumentApprovalActions
                    caseId={c.caseId}
                    documentId={d.documentId}
                    documentName={d.documentName}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* (val 2026-06-14, #661) Parties moved into the two-column sidebar
            above — grouped by Trustors / Trustees / Beneficiaries. */}

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
    </>
  );
}
