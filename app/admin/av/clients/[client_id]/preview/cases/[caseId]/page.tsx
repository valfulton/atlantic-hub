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
import { loadFullCase, findIndexableDocumentForCase } from '@/lib/case/case_store';
import SectionText from '@/components/case/SectionText';
import ActionItemDetail, { buildOptionDocsMap } from '@/components/case/ActionItemDetail';
import FamilyFindingsPanel from '@/components/case/FamilyFindingsPanel';
import { listFamilyVisibleFindingsForCase } from '@/lib/case/document_findings_store';
// (val 2026-06-15, #685) Attorney + firm + party extracts — same panel as
// operator + family. Mounted here so preview-as-family also shows it.
import DocumentExtractsPanel from '@/components/case/DocumentExtractsPanel';
import { listExtractsForCase } from '@/lib/case/document_extracts_store';
import { loadFullWellness } from '@/lib/case/family_wellness';
import {
  resolveCaseViewerRole,
  visibleFor,
  listViewAsCandidates,
  caseAccessibleAsClient,
  listCollaboratorsForCase,
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

/**
 * Parse synopsis verbatim — mirrors /client/cases/[caseId].
 *   (val 2026-06-14, #661 v4)
 * Honors `\n\n` for paragraphs. Recognizes `[STATUS]…[/STATUS]` as a
 * thin-garnet-rule callout. Never auto-splits sentences.
 */
type SynopsisBlock =
  | { kind: 'prose'; text: string }
  | { kind: 'status'; text: string };

function parseSynopsis(text: string | null | undefined): SynopsisBlock[] {
  if (!text) return [];
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paras.map<SynopsisBlock>((p) => {
    const m = p.match(/^\[STATUS\]([\s\S]*?)\[\/STATUS\]$/);
    if (m) return { kind: 'status', text: m[1].trim() };
    return { kind: 'prose', text: p };
  });
}

interface PartyLike {
  partyId: number; fullName: string; role: string | null;
  relationship: string | null;
}

function groupParties(parties: PartyLike[]): Array<{ label: string; members: PartyLike[] }> {
  // (val 2026-06-15, #664) Successor check MUST precede plain trustee
  // since 'successor_trustee' contains 'trustee'. Rebecca was being
  // mis-bucketed with Cecilia until we caught this.
  const buckets: Record<string, PartyLike[]> = {
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

function familyFacingRoleLabel(dbRole: string | null | undefined): string {
  switch ((dbRole || '').toLowerCase()) {
    case 'attorney':
    case 'advisor':
      return 'Legal Document Assistant';
    case 'sibling_admin':
      return 'Account representative';
    case 'sibling_commenter':
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
  if (!peek) notFound();
  // (val 2026-06-14, #659) Brand-scope check mirrors the matters card rule —
  // a case is reachable in this preview if it's homed on this brand OR a
  // non-revoked collaborator row exists with via_client_id = this brand.
  // Without this, Adriana's CLDA preview 404s on Johnson because Johnson is
  // homed on AV Real Estate (client_id 13), not CLDA (10) — but she works it
  // through CLDA via fcc.via_client_id=10.
  const accessible = await caseAccessibleAsClient(caseId, clientId, peek.case.clientId);
  if (!accessible) notFound();

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
  // (val 2026-06-15, #667) Reviewers deduped by displayName first.
  // Adriana has two client_users rows (CBB + CLDA setup), likely with
  // different brand-specific emails — name is the durable identity.
  const collaborators = await listCollaboratorsForCase(caseId);
  const seenReviewerKeys = new Set<string>();
  const reviewers = collaborators
    .filter((cc) => !cc.revokedAt && (cc.role === 'attorney' || cc.role === 'advisor'))
    .filter((cc) => {
      const name = cc.displayName?.trim().toLowerCase();
      const email = cc.email?.trim().toLowerCase();
      const key = name ? `n:${name}` : email ? `e:${email}` : `u:${cc.clientUserId}`;
      if (seenReviewerKeys.has(key)) return false;
      seenReviewerKeys.add(key);
      return true;
    });

  // (val 2026-06-15, #662) Split docs — approved → sidebar Documents panel,
  // pending → main column with Approve/Reject actions.
  const pendingDocs = full.documents.filter((d) => d.approvalStatus === 'pending_review');
  const approvedDocs = full.documents.filter((d) => d.approvalStatus === 'approved');
  // (val 2026-06-15, #665) Option letter → document map. Same logic as the
  // live family view so operator preview matches what Mrs. Johnson sees.
  const linkableDocs = full.documents.filter((d) => d.approvalStatus !== 'rejected');
  const optionDocs = buildOptionDocsMap(linkableDocs);

  // (val 2026-06-15) Load the indexable trust/will PDF so §-refs in the
  // synopsis + outstanding items become clickable deep links to the right
  // page in the PDF. Mirror parity with /client/cases/[caseId] — operator
  // viewing the preview must see and verify the same links the family sees.
  const [indexableDoc, familyFindings, docExtracts] = await Promise.all([
    findIndexableDocumentForCase(caseId),
    listFamilyVisibleFindingsForCase(caseId),
    // (val 2026-06-15, #685) Attorney + firm + party extracts for the family view.
    listExtractsForCase(caseId)
  ]);
  const sectionDocUrl = indexableDoc
    ? `/api/admin/av/cases/${c.caseId}/documents/${indexableDoc.documentId}`
    : null;
  const sectionIndex = indexableDoc?.sectionIndex ?? null;
  const docReviewer = reviewers.find(r => /attorney|legal/i.test(r.role || '')) || null;

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

          {/* (val 2026-06-14, #661 v4) Two-column document layout — mirror of
              /client/cases/[caseId]. Header band + Summary/Outstanding-items
              main column + Property/Parties/Trust-provisions/Review-&-approval
              sidebar. Sidebar stacks below on mobile (≤760px). */}
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
            {/* Status markers — same rule as the live family view: don't
                surface "Open" alone (val 2026-06-15). Only render when
                something meaningful is set. */}
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

          <div className="case-grid">
            <style>{`
              .case-grid { display: grid; grid-template-columns: 1fr 300px; gap: 40px; align-items: start; }
              .case-grid h2.case-h { font-family: 'Fraunces','Cormorant Garamond',Georgia,serif; font-weight: 500; font-size: 1.32rem; color: var(--ink); margin: 0 0 14px; padding-bottom: 9px; border-bottom: 1px solid rgba(10,77,60,0.14); }
              .case-grid .prose-p { font-size: 17px; line-height: 1.74; color: var(--ink); margin: 0 0 14px; white-space: pre-wrap; }
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
                          <Link
                            href={`/admin/av/clients/${clientId}/preview/cases/${caseId}/actions/${a.actionId}`}
                            className="ai-title"
                          >
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

              {/* (#669) Preview-mirror parity: family findings panel
                  appears here so val can verify what Rebecca/parents see. */}
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

              {/* (val 2026-06-15, #685) Attorney + firm + party extracts —
                  same panel surfaces on operator + family + this preview. */}
              <DocumentExtractsPanel
                caseId={c.caseId}
                extracts={docExtracts}
                documents={full.documents.map((d) => ({
                  documentId: d.documentId,
                  documentName: d.documentName
                }))}
              />
            </div>

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

              {(() => {
                const tp = c.metadata?.trust_provisions;
                if (!Array.isArray(tp) || tp.length === 0) return null;
                return (
                  <div className="panel">
                    <p className="panel-h">Trust provisions</p>
                    {tp.map((p, i) => {
                      const item = p as { section_key?: string; description?: string };
                      if (!item.section_key) return null;
                      return (
                        <div key={i} className="prov">
                          <span style={{ fontFamily: 'Fraunces,Georgia,serif', fontSize: 13, fontWeight: 600, color: 'var(--emerald-deep, #0A4D3C)', flex: '0 0 auto' }}>§{item.section_key}</span>
                          <span>{item.description || ''}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

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

              {/* Documents — downloadable docs in sidebar (val 2026-06-15, #662). */}
              {approvedDocs.length > 0 && (
                <div className="panel">
                  <p className="panel-h">Documents</p>
                  {approvedDocs.map((d) => (
                    <div key={d.documentId} className="doc-row">
                      {/* (#675) Viewer page — preview mirrors the family link. */}
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

          {/* (val 2026-06-15, #662) Approved docs → sidebar Documents panel.
              Pending docs (with Approve/Reject) keep their prominent main
              column placement — they have interactive controls. */}
          {pendingDocs.length > 0 && (
            <section style={{ background: 'var(--paper, #FFFFFF)', border: '1px solid var(--gold-deep, #7A5A18)', borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold-deep, #7A5A18)', marginBottom: 4 }}>
                Awaiting your decision
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted, #3B4944)', marginBottom: 14 }}>
                Drafts are ready for your review. Approve each one, or send it back with a note.
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
                {pendingDocs.map((d) => (
                  <li key={d.documentId} style={{ borderLeft: '3px solid var(--gold-deep, #7A5A18)', paddingLeft: 14 }}>
                    {/* (#675) Viewer page — same target the family clicks. */}
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

          {/* (val 2026-06-15, #662) Parties moved into sidebar — Trustors /
              Trustees / Beneficiaries grouped. This duplicate block removed. */}

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
