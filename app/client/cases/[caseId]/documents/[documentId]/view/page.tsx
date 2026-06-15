/**
 * /client/cases/[caseId]/documents/[documentId]/view
 *   (val 2026-06-15, #675 Tier A)
 *
 * Family-facing document viewer. Replaces the byte-serve-direct click that
 * Safari was force-downloading for .md / .docx. Renders inline regardless of
 * file type — PDF iframe, markdown→HTML, image, .docx fallback, etc. (see
 * lib/case/document_view_renderer.tsx for the per-mime branches).
 *
 * Access gate:
 *   - client_user must pass canClientUserAccessCase for the case
 *   - operator (any role !== 'client_user') goes through unconditionally,
 *     so operator preview mode renders the same viewer
 *
 * The byte-serve URL we hand to the renderer is the same /api/admin/av/cases
 * endpoint the case page already uses — it accepts both roles and serves
 * 'inline' headers, which the renderer relies on for the PDF + image
 * branches.
 */
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getDocument, canClientUserAccessCase, loadFullCase } from '@/lib/case/case_store';
import DocumentViewRenderer from '@/lib/case/document_view_renderer';
import { getHotStorage } from '@/lib/storage/provider';
import MarkdownEditButton from '@/components/case/MarkdownEditButton';
import { resolveCaseViewerRole, canEditCaseDocuments } from '@/lib/case/case_collaborators';

export const dynamic = 'force-dynamic';

// Same allowlist the renderer + API use to decide what's editable.
function isMarkdownDoc(mime: string | null, name: string): boolean {
  const mt = (mime || '').toLowerCase();
  if (mt === 'text/markdown' || mt === 'text/x-markdown') return true;
  return /\.(md|markdown)$/i.test(name);
}
export const runtime = 'nodejs';

const CREAM_SKIN = {
  '--ink': '#14201B',
  '--ink-soft': '#3C4A43',
  '--muted': '#5C6862',
  '--paper': '#FFFFFF',
  '--cream': '#FAF8F4',
  '--emerald-deep': '#0A4D3C'
} as CSSProperties;

interface PageProps {
  params: { caseId: string; documentId: string };
}

export default async function CaseDocumentViewPage({ params }: PageProps) {
  const caseId = parseInt(params.caseId, 10);
  const documentId = parseInt(params.documentId, 10);
  if (!Number.isFinite(caseId) || caseId <= 0 ||
      !Number.isFinite(documentId) || documentId <= 0) {
    notFound();
  }

  // Auth — same flow the existing case page uses (actor.clientUserId, not
  // .userId; headers() needs the cast). Both are easy to get wrong — the
  // first Netlify build failed on exactly this drift.
  const actor = readClientActorFromHeaders(headers() as unknown as Headers);
  if (!actor) redirect(`/client/login?next=/client/cases/${caseId}/documents/${documentId}/view`);

  const user = await findClientUserById(actor.clientUserId);
  if (!user) redirect('/client/login');

  const primaryClientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);
  if (!primaryClientId) notFound();

  const allowed = await canClientUserAccessCase(actor.clientUserId, primaryClientId, caseId);
  if (!allowed) notFound();

  // Document — confirm it belongs to the case in the URL (IDOR guard).
  const doc = await getDocument(documentId);
  if (!doc || doc.caseId !== caseId) notFound();

  const byteServeUrl = `/api/admin/av/cases/${caseId}/documents/${documentId}`;

  // (#679 v3, val 2026-06-15) Lock the parents out of editing. Lifetime
  // beneficiaries (Gordon + Maria) need to be able to READ the case file
  // without any chance of accidentally damaging information. Editing
  // stays available to:
  //   account_rep  — Rebecca, sibling_admin
  //   professional — Adriana
  // See canEditCaseDocuments() for the canonical allowlist.
  let viewerRole: Awaited<ReturnType<typeof resolveCaseViewerRole>> = 'unknown';
  try {
    // loadFullCase returns the case row so we can pass case_clientId to the
    // role resolver — the resolver shortcuts to 'parent' when the viewer's
    // client_users.client_id matches the case's owning client.
    const full = await loadFullCase(caseId);
    viewerRole = await resolveCaseViewerRole(
      actor.clientUserId,
      caseId,
      full?.case?.clientId ?? null
    );
  } catch (err) {
    console.error('family viewer role resolve failed', err);
  }
  const mayEdit = canEditCaseDocuments(viewerRole);

  let editableSource: string | null = null;
  if (mayEdit && isMarkdownDoc(doc.mimeType, doc.documentName)) {
    try {
      const bytes = await getHotStorage('case-documents').getBytes(doc.storageUri);
      if (bytes) {
        editableSource = Buffer.from(bytes).toString('utf-8');
      }
    } catch (err) {
      console.error('family viewer pre-load source failed', err);
    }
  }

  return (
    <main
      data-surface="client"
      style={{
        ...CREAM_SKIN,
        background: 'var(--cream)',
        minHeight: '100vh',
        color: 'var(--ink)'
      }}
    >
      <header
        style={{
          maxWidth: 980,
          margin: '0 auto',
          padding: '28px 24px 12px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 16,
          flexWrap: 'wrap'
        }}
      >
        <Link
          href={`/client/cases/${caseId}`}
          style={{
            fontSize: 13,
            color: 'var(--emerald-deep)',
            textDecoration: 'none',
            borderBottom: '1px solid rgba(10,77,60,0.35)'
          }}
        >
          ← Back to matter
        </Link>
        <h1
          style={{
            fontFamily: '"Fraunces", Georgia, serif',
            fontSize: 22,
            fontWeight: 500,
            margin: 0,
            color: 'var(--ink)',
            flex: 1
          }}
        >
          {doc.documentName}
        </h1>
        <a
          href={byteServeUrl}
          download={doc.documentName}
          style={{
            fontSize: 12,
            color: 'var(--ink-soft)',
            textDecoration: 'none',
            border: '1px solid rgba(10,77,60,0.25)',
            padding: '4px 10px',
            borderRadius: 6
          }}
        >
          Download
        </a>
      </header>

      <section style={{ maxWidth: 980, margin: '0 auto', padding: '8px 24px 60px' }}>
        {editableSource != null ? (
          /* (#676 Tier B v2) Family-side markdown editing — Adriana
              asked. Same edit toggle the operator viewer uses; the API
              accepts client_user with case access. */
          <MarkdownEditButton
            caseId={doc.caseId}
            documentId={doc.documentId}
            initialSource={editableSource}
          >
            <DocumentViewRenderer
              doc={{
                documentId: doc.documentId,
                caseId: doc.caseId,
                documentName: doc.documentName,
                mimeType: doc.mimeType,
                storageUri: doc.storageUri,
                sizeBytes: doc.sizeBytes ?? null
              }}
              byteServeUrl={byteServeUrl}
            />
          </MarkdownEditButton>
        ) : (
          <DocumentViewRenderer
            doc={{
              documentId: doc.documentId,
              caseId: doc.caseId,
              documentName: doc.documentName,
              mimeType: doc.mimeType,
              storageUri: doc.storageUri,
              sizeBytes: doc.sizeBytes ?? null
            }}
            byteServeUrl={byteServeUrl}
          />
        )}
      </section>
    </main>
  );
}
