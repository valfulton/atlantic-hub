/**
 * /admin/av/clients/[client_id]/cases/[caseId]/documents/[documentId]/view
 *   (val 2026-06-15, #675 Tier A)
 *
 * Operator-facing document viewer — mirror of the family viewer at
 * /client/cases/[caseId]/documents/[documentId]/view. Same renderer, same
 * inline behavior; the URL prefix + back-link target differ so val sees
 * operator-side chrome with a back-link into the operator case dashboard.
 *
 * Gated by the /admin/* middleware (auth happens there), so we don't need
 * an explicit session check on this page. We DO verify the doc belongs to
 * the case in the URL — IDOR guard.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDocument } from '@/lib/case/case_store';
import DocumentViewRenderer from '@/lib/case/document_view_renderer';
import { getHotStorage } from '@/lib/storage/provider';
import MarkdownEditButton from '@/components/case/MarkdownEditButton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Same allowlist the API + the renderer use to decide what's editable.
function isMarkdownDoc(mime: string | null, name: string): boolean {
  const mt = (mime || '').toLowerCase();
  if (mt === 'text/markdown' || mt === 'text/x-markdown') return true;
  return /\.(md|markdown)$/i.test(name);
}

interface PageProps {
  params: { client_id: string; caseId: string; documentId: string };
}

export default async function OperatorDocumentViewPage({ params }: PageProps) {
  const clientId = parseInt(params.client_id, 10);
  const caseId = parseInt(params.caseId, 10);
  const documentId = parseInt(params.documentId, 10);
  if (
    !Number.isFinite(clientId) || clientId <= 0 ||
    !Number.isFinite(caseId) || caseId <= 0 ||
    !Number.isFinite(documentId) || documentId <= 0
  ) {
    notFound();
  }

  const doc = await getDocument(documentId);
  if (!doc || doc.caseId !== caseId) notFound();

  const byteServeUrl = `/api/admin/av/cases/${caseId}/documents/${documentId}`;
  const backToCase = `/admin/av/clients/${clientId}/cases/${caseId}`;

  // (#676 Tier B) If this is a markdown document, pre-load the source so
  // the operator Edit button has it ready without a separate client fetch
  // on first click. We fail-soft — if the bytes are missing or the read
  // throws, editing is unavailable but the viewer still renders.
  let editableSource: string | null = null;
  if (isMarkdownDoc(doc.mimeType, doc.documentName)) {
    try {
      const bytes = await getHotStorage('case-documents').getBytes(doc.storageUri);
      if (bytes) {
        editableSource = Buffer.from(bytes).toString('utf-8');
      }
    } catch (err) {
      console.error('viewer pre-load source failed', err);
    }
  }

  return (
    <main style={{ background: '#0b1220', minHeight: '100vh', color: '#f1f5f9' }}>
      <header
        style={{
          maxWidth: 980,
          margin: '0 auto',
          padding: '24px 24px 12px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 16,
          flexWrap: 'wrap'
        }}
      >
        <Link
          href={backToCase}
          style={{
            fontSize: 13,
            color: '#E6CE7E',
            textDecoration: 'none',
            borderBottom: '1px solid rgba(230,206,126,0.35)'
          }}
        >
          ← Back to case
        </Link>
        <h1
          style={{
            fontFamily: '"Inter", system-ui, sans-serif',
            fontSize: 18,
            fontWeight: 600,
            margin: 0,
            flex: 1,
            color: '#f1f5f9'
          }}
        >
          {doc.documentName}
          {doc.documentKind && (
            <span style={{
              marginLeft: 12,
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              color: '#94a3b8',
              fontWeight: 500
            }}>
              {doc.documentKind}
            </span>
          )}
        </h1>
        <a
          href={byteServeUrl}
          download={doc.documentName}
          style={{
            fontSize: 12,
            color: '#94a3b8',
            textDecoration: 'none',
            border: '1px solid rgba(255,255,255,0.18)',
            padding: '4px 10px',
            borderRadius: 6
          }}
        >
          Download
        </a>
      </header>

      <section style={{ maxWidth: 980, margin: '0 auto', padding: '8px 24px 60px' }}>
        {editableSource != null ? (
          /* (#676 Tier B) Markdown — wrap the rendered preview in the
              Edit toggle. Children are the rendered preview, shown when
              not editing; on Edit click, the textarea takes the same
              slot and the children hide. */
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
