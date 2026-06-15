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
import { getDocument, canClientUserAccessCase } from '@/lib/case/case_store';
import DocumentViewRenderer from '@/lib/case/document_view_renderer';

export const dynamic = 'force-dynamic';
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

  // Auth — same flow the existing case page uses.
  const h = headers();
  const actor = readClientActorFromHeaders(h);
  if (!actor) redirect(`/client/login?next=/client/cases/${caseId}/documents/${documentId}/view`);

  const user = await findClientUserById(actor.userId);
  if (!user) redirect('/client/login');

  const primaryClientId = await activeBrandFor(actor.userId, user.client_id ?? null);
  if (!primaryClientId) notFound();

  const allowed = await canClientUserAccessCase(actor.userId, primaryClientId, caseId);
  if (!allowed) notFound();

  // Document — confirm it belongs to the case in the URL (IDOR guard).
  const doc = await getDocument(documentId);
  if (!doc || doc.caseId !== caseId) notFound();

  const byteServeUrl = `/api/admin/av/cases/${caseId}/documents/${documentId}`;

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
      </section>
    </main>
  );
}
