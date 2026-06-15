/**
 * components/case/DocumentFindingsPanel.tsx  (val 2026-06-15, #666)
 *
 * Operator-only sibling to DocumentVaultPanel. Shows each PDF in the case
 * with a "Read & flag oddities" button (delegated to DocumentReadButton)
 * and any previously-stored findings rendered inline below the row.
 *
 * Mount only on /admin/av/clients/[id]/cases/[caseId] — NEVER on /client/*.
 */
import DocumentReadButton from './DocumentReadButton';
import type { DocumentFinding } from '@/lib/case/document_findings_store';

interface DocLite {
  documentId: number;
  documentName: string;
  documentKind: string | null;
  mimeType: string | null;
}

interface Props {
  caseId: number;
  documents: DocLite[];
  /** All existing findings on the case, grouped per document below. */
  existingFindings: DocumentFinding[];
  /** Trust/will/etc — byte-serve URL of the indexable document. When passed,
   *  each finding's §-ref and page number become click-jumps to the right
   *  page in the PDF. (#672) */
  indexableDocumentUrl?: string | null;
  indexableDocumentId?: number | null;
}

export default function DocumentFindingsPanel({ caseId, documents, existingFindings, indexableDocumentUrl, indexableDocumentId }: Props) {
  const pdfs = documents.filter((d) => d.mimeType === 'application/pdf');
  if (pdfs.length === 0) return null;

  // Group findings by documentId for O(1) lookup at render time.
  const byDoc = new Map<number, DocumentFinding[]>();
  for (const f of existingFindings) {
    const arr = byDoc.get(f.documentId) || [];
    arr.push(f);
    byDoc.set(f.documentId, arr);
  }

  return (
    <section className="rounded-xl border border-border bg-[var(--surface-2)] p-5">
      <h2 className="text-sm uppercase tracking-wider text-muted mb-3">
        Document findings ({existingFindings.length})
      </h2>
      <p className="text-xs text-muted mb-4 leading-relaxed">
        Read any uploaded PDF with the LLM scanner. Findings are stored per
        document and surface here. Re-running replaces prior findings — the
        operator can refresh any time the doc changes.
      </p>
      <ul className="space-y-4">
        {pdfs.map((d) => {
          const docFindings = byDoc.get(d.documentId) || [];
          const initial = docFindings.map((f) => ({
            findingId: f.findingId,
            documentId: f.documentId,
            caseId: f.caseId,
            sectionKey: f.sectionKey,
            quote: f.quote,
            oddityType: f.oddityType,
            severity: f.severity,
            visibility: f.visibility,
            pageNumber: f.pageNumber,
            llmNote: f.llmNote,
            modelId: f.modelId
          }));
          return (
            <li key={d.documentId} className="border-b border-border pb-3 last:border-0">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <div className="text-sm font-medium text-ink-on-dark">
                  {d.documentName}
                </div>
                {d.documentKind && (
                  <span className="text-[10px] uppercase tracking-wider text-muted">
                    {d.documentKind}
                  </span>
                )}
              </div>
              <DocumentReadButton
                caseId={caseId}
                documentId={d.documentId}
                documentName={d.documentName}
                initialFindings={initial}
                indexableDocumentUrl={indexableDocumentUrl ?? null}
                indexableDocumentId={indexableDocumentId ?? null}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
