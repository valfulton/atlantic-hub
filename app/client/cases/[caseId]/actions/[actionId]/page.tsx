/**
 * /client/cases/[caseId]/actions/[actionId]  (val 2026-06-12)
 *
 * Client mirror of the action item detail page. Same data, cream skin,
 * read-only editor (status changes coming once we add a client-scoped PATCH),
 * full notes thread (read + write).
 *
 * Access: anyone who passes canClientUserAccessCase (primary client OR
 * approved collaborator). Adriana as attorney + Rebecca as primary caregiver
 * both get in.
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
import {
  getActionItem,
  getCase,
  listActionItemNotes,
  canClientUserAccessCase,
  findIndexableDocumentForCase
} from '@/lib/case/case_store';
import SectionText from '@/components/case/SectionText';
import ActionItemNotesPanel from '@/components/case/ActionItemNotesPanel';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
  params: { caseId: string; actionId: string };
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso.slice(0, 10); }
}

export default async function ClientActionDetailPage({ params }: PageProps) {
  const caseId = parseInt(params.caseId, 10);
  const actionId = parseInt(params.actionId, 10);
  if (!Number.isInteger(caseId) || !Number.isInteger(actionId)) notFound();

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

  const [action, caseRow, notes, indexableDoc] = await Promise.all([
    getActionItem(actionId),
    getCase(caseId),
    listActionItemNotes(actionId),
    findIndexableDocumentForCase(caseId)
  ]);
  if (!action || action.caseId !== caseId) notFound();
  if (!caseRow) notFound();

  // IDOR check
  const canAccess =
    caseRow.clientId === clientId
    || await canClientUserAccessCase(actor.clientUserId, clientId, caseId);
  if (!canAccess) notFound();

  const sectionDocUrl = indexableDoc
    ? `/api/admin/av/cases/${caseId}/documents/${indexableDoc.documentId}`
    : null;
  const sectionIndex = indexableDoc?.sectionIndex ?? null;

  return (
    <>
      {/* (val 2026-06-13) Nav fix — without ClientV3TopNav, Rebecca / Adriana
          had no way to navigate off the action detail page on desktop. */}
      <ClientV3TopNav />
    <main className="min-h-screen" style={{ ...CREAM_SKIN, background: 'var(--cream)', color: 'var(--ink)' }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1.25rem 4rem' }}>
        {/* Breadcrumb */}
        <div style={{ fontSize: 11, color: 'var(--muted, #3B4944)', marginBottom: 18 }}>
          <Link href="/client/cases" style={{ color: 'var(--gold-deep, #7A5A18)' }}>Your matters</Link>
          <span style={{ margin: '0 6px' }}>·</span>
          <Link href={`/client/cases/${caseId}`} style={{ color: 'var(--gold-deep, #7A5A18)' }}>{caseRow.caseName}</Link>
          <span style={{ margin: '0 6px' }}>·</span>
          <span>Action item</span>
        </div>

        {/* Header */}
        <header style={{ marginBottom: '1.75rem' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
              padding: '2px 8px', borderRadius: 6,
              background: action.priority === 'urgent' ? '#A23B2E' : (action.priority === 'high' ? 'var(--gold-deep, #7A5A18)' : 'rgba(10,10,10,0.08)'),
              color: action.priority === 'urgent' || action.priority === 'high' ? '#fff' : 'var(--ink)'
            }}>
              {action.priority}
            </span>
            <span style={{
              fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'var(--muted, #3B4944)'
            }}>
              {action.status.replace(/_/g, ' ')}
            </span>
            {action.dueDate && (
              <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted, #3B4944)' }}>
                Due {formatDate(action.dueDate)}
              </span>
            )}
          </div>
          <h1 style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontWeight: 500, fontSize: 30, lineHeight: 1.15 }}>
            {action.title}
          </h1>
        </header>

        {/* Detail */}
        {action.detail && (
          <section style={{
            background: 'var(--paper, #FFFFFF)',
            border: '0.5px solid rgba(10,10,10,0.1)',
            borderRadius: 14, padding: '22px 24px', marginBottom: '1.5rem'
          }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #3B4944)', marginBottom: 10 }}>
              Detail
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
              <SectionText
                text={action.detail}
                documentUrl={sectionDocUrl}
                sectionIndex={sectionIndex}
              />
            </div>
          </section>
        )}

        {/* Notes */}
        <section style={{
          background: 'var(--paper, #FFFFFF)',
          border: '0.5px solid rgba(10,10,10,0.1)',
          borderRadius: 14, padding: '22px 24px'
        }}>
          <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted, #3B4944)', marginBottom: 12 }}>
            Notes ({notes.length})
          </div>
          <ActionItemNotesPanel
            caseId={caseId}
            actionId={actionId}
            initialNotes={notes}
            sectionDocUrl={sectionDocUrl}
            sectionIndex={sectionIndex}
          />
        </section>
      </div>
    </main>
    </>
  );
}
