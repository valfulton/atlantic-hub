/**
 * lib/case/document_view_renderer.tsx  (val 2026-06-15, #675 Tier A)
 *
 * Shared server component that renders a case document inline. Picks the
 * right preview based on the document's mime type:
 *
 *   PDF              → embedded iframe pointing at the byte-serve endpoint
 *                      (already returns 'inline' headers; PDFs respect
 *                      #page=N anchors, so deep links into §-refs still work)
 *   markdown         → server-rendered HTML via markdownToSafeHtml (zero-dep)
 *   text/* (other)   → escaped <pre>
 *   image/*          → <img> pointing at byte-serve
 *   .docx / .doc     → explicit "preview not available" with download link
 *                      (Tier C upgrade adds mammoth-based preview)
 *   anything else    → explicit download link
 *
 * This component is mounted by BOTH the family viewer page and the operator
 * viewer page, so behavior stays identical across surfaces.
 */
import { markdownToSafeHtml } from './markdown_mini';
import { getHotStorage } from '@/lib/storage/provider';

/** Same shape that case_store.getDocument returns — but we only need this
 *  subset so the renderer doesn't pull a circular import. */
export interface ViewableDocument {
  documentId: number;
  caseId: number;
  documentName: string;
  mimeType: string | null;
  storageUri: string;
  sizeBytes: number | null;
}

function isMarkdown(doc: ViewableDocument): boolean {
  const mt = (doc.mimeType || '').toLowerCase();
  if (mt === 'text/markdown' || mt === 'text/x-markdown') return true;
  // Many uploaders send octet-stream for .md — fall back to filename.
  return /\.(md|markdown)$/i.test(doc.documentName);
}

function isPlainText(doc: ViewableDocument): boolean {
  const mt = (doc.mimeType || '').toLowerCase();
  if (mt.startsWith('text/')) return true;
  return /\.(txt|log|csv)$/i.test(doc.documentName);
}

function isPdf(doc: ViewableDocument): boolean {
  const mt = (doc.mimeType || '').toLowerCase();
  if (mt === 'application/pdf') return true;
  return /\.pdf$/i.test(doc.documentName);
}

function isImage(doc: ViewableDocument): boolean {
  const mt = (doc.mimeType || '').toLowerCase();
  if (mt.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(doc.documentName);
}

function isWord(doc: ViewableDocument): boolean {
  const mt = (doc.mimeType || '').toLowerCase();
  if (mt === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return true;
  if (mt === 'application/msword') return true;
  return /\.(docx|doc)$/i.test(doc.documentName);
}

interface Props {
  doc: ViewableDocument;
  /** Byte-serve URL — same for family + operator since the API allows both. */
  byteServeUrl: string;
}

/** Read the doc's bytes from hot storage and return as a UTF-8 string.
 *  Used for markdown + plain text preview. Returns null on failure so the
 *  page can fall back to a download link. */
async function readBytesAsText(storageUri: string): Promise<string | null> {
  try {
    const bytes = await getHotStorage('case-documents').getBytes(storageUri);
    if (!bytes) return null;
    return Buffer.from(bytes).toString('utf-8');
  } catch (err) {
    console.error('readBytesAsText failed', err);
    return null;
  }
}

export default async function DocumentViewRenderer({ doc, byteServeUrl }: Props) {
  // PDF — iframe is the cleanest cross-browser inline render and preserves
  // #page=N deep-link semantics for §-ref jumps.
  if (isPdf(doc)) {
    return (
      <iframe
        src={byteServeUrl}
        title={doc.documentName}
        style={{
          width: '100%',
          height: 'calc(100vh - 180px)',
          minHeight: 600,
          border: '1px solid rgba(10,77,60,0.18)',
          borderRadius: 8,
          background: '#fff'
        }}
      />
    );
  }

  // Image — direct render, capped width for the page.
  if (isImage(doc)) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={byteServeUrl}
          alt={doc.documentName}
          style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 220px)', borderRadius: 8 }}
        />
      </div>
    );
  }

  // Markdown — server-render to HTML using the zero-dep mini renderer.
  if (isMarkdown(doc)) {
    const src = await readBytesAsText(doc.storageUri);
    if (src == null) {
      return <DownloadFallback doc={doc} byteServeUrl={byteServeUrl} reason="couldn't load file contents" />;
    }
    const html = markdownToSafeHtml(src);
    return (
      <article
        className="doc-md"
        style={{
          background: '#FFFFFF',
          border: '1px solid rgba(10,77,60,0.18)',
          borderRadius: 8,
          padding: '32px 40px',
          maxWidth: 760,
          margin: '0 auto',
          lineHeight: 1.65,
          fontFamily: '"Fraunces", "Cormorant Garamond", Georgia, serif',
          fontSize: 17,
          color: 'var(--ink, #14201B)'
        }}
        // Safe: markdownToSafeHtml escapes user text + restricts hrefs.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // Plain text — escaped <pre>.
  if (isPlainText(doc)) {
    const src = await readBytesAsText(doc.storageUri);
    if (src == null) {
      return <DownloadFallback doc={doc} byteServeUrl={byteServeUrl} reason="couldn't load file contents" />;
    }
    return (
      <pre
        style={{
          background: '#FFFFFF',
          border: '1px solid rgba(10,77,60,0.18)',
          borderRadius: 8,
          padding: '24px 28px',
          maxWidth: 880,
          margin: '0 auto',
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word',
          fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
          fontSize: 14,
          color: 'var(--ink, #14201B)'
        }}
      >
        {src}
      </pre>
    );
  }

  // Word document — explicit, friendly download. Tier C upgrade will use
  // mammoth to render docx inline; today we just stop the surprise-Save
  // dialog from earlier and explain what's happening.
  if (isWord(doc)) {
    return (
      <DownloadFallback
        doc={doc}
        byteServeUrl={byteServeUrl}
        reason="Word documents preview in Word, not in the browser"
        downloadLabel="Open in Word"
      />
    );
  }

  // Default — explicit download with a friendly explanation.
  return (
    <DownloadFallback
      doc={doc}
      byteServeUrl={byteServeUrl}
      reason="we don't have an inline preview for this file type yet"
    />
  );
}

interface DownloadFallbackProps {
  doc: ViewableDocument;
  byteServeUrl: string;
  reason: string;
  downloadLabel?: string;
}

function DownloadFallback({ doc, byteServeUrl, reason, downloadLabel }: DownloadFallbackProps) {
  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '1px solid rgba(10,77,60,0.18)',
        borderRadius: 8,
        padding: '40px 32px',
        maxWidth: 560,
        margin: '40px auto',
        textAlign: 'center',
        fontFamily: '"Fraunces", Georgia, serif',
        color: 'var(--ink, #14201B)'
      }}
    >
      <div style={{ fontSize: 17, marginBottom: 6, fontWeight: 600 }}>{doc.documentName}</div>
      <div style={{ fontSize: 13, color: 'var(--ink-soft, #3C4A43)', marginBottom: 22 }}>{reason}.</div>
      <a
        href={byteServeUrl}
        download={doc.documentName}
        style={{
          display: 'inline-block',
          background: 'var(--emerald-deep, #0A4D3C)',
          color: '#FFFFFF',
          padding: '10px 22px',
          borderRadius: 6,
          textDecoration: 'none',
          fontSize: 14,
          fontWeight: 600
        }}
      >
        {downloadLabel ?? 'Download to view'}
      </a>
    </div>
  );
}
