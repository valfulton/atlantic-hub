/**
 * components/case/DraftingAttorneyHero.tsx  (val 2026-06-15, #690)
 *
 * Hero card at the top of the case page. Surfaces the drafting attorney +
 * firm + key contact details prominently — pulled from document_extracts.
 *
 * Universal across case_kinds: trust, will, estate, probate, contract, etc.
 * Auto-hides when no attorney or firm extracts exist (works for non-legal
 * cases without becoming dead chrome).
 *
 * Mounted on both family + operator case pages so the people on the case
 * always see "who wrote this" at a glance — without scrolling through
 * Synopsis + Timeline + Outstanding items first.
 *
 * Server component — no client JS needed.
 */
import Link from 'next/link';
import type { DocumentExtract } from '@/lib/case/document_extracts_store';

interface DocLite {
  documentId: number;
  documentName: string;
}

interface Props {
  caseId: number;
  extracts: DocumentExtract[];
  documents: DocLite[];
  /**
   * URL pattern for opening the source document. Family side passes
   * /client/cases/[caseId]/documents/[documentId]/view; operator
   * passes /admin/av/clients/[clientId]/cases/[caseId]/documents/[id]/view.
   */
  documentViewerUrlFor: (documentId: number, pageNumber: number | null) => string;
}

/** Find the FIRST non-empty extract for a given kind+label hint. */
function findExtract(
  extracts: DocumentExtract[],
  kind: string,
  labelHint?: RegExp
): DocumentExtract | null {
  for (const e of extracts) {
    if (e.kind !== kind) continue;
    if (!e.value || !e.value.trim()) continue;
    if (labelHint && !labelHint.test(e.label || '')) continue;
    return e;
  }
  return null;
}

export default function DraftingAttorneyHero({ caseId: _caseId, extracts, documents, documentViewerUrlFor }: Props) {
  // Resolve the drafting attorney + firm + key contact details. We prefer
  // labels with "drafting" but fall back to ANY attorney/firm row.
  const attorney = findExtract(extracts, 'attorney', /drafting|primary/i)
    || findExtract(extracts, 'attorney');
  const firm = findExtract(extracts, 'firm', /drafting|primary/i)
    || findExtract(extracts, 'firm');
  const firmAddress = findExtract(extracts, 'address', /firm/i);
  const firmPhone = findExtract(extracts, 'contact', /firm|phone/i);
  const barNumber = findExtract(extracts, 'bar_number');

  // Show the hero ONLY when at least one of attorney or firm is populated.
  // Otherwise it's dead chrome on cases that haven't been scanned yet
  // or non-legal cases.
  if (!attorney && !firm) return null;

  const docMap = new Map<number, string>();
  for (const d of documents) docMap.set(d.documentId, d.documentName);

  const sourceFor = (e: DocumentExtract | null) => {
    if (!e) return null;
    const docName = docMap.get(e.documentId);
    return docName ? { docName: docName.replace(/\.[a-z]+$/i, ''), page: e.pageNumber } : null;
  };

  // Pick the most authoritative source for the "Open document" link —
  // prefer the attorney extract's page, fall back to firm.
  const primarySource = attorney || firm;
  const primarySourceUrl = primarySource
    ? documentViewerUrlFor(primarySource.documentId, primarySource.pageNumber)
    : null;

  return (
    <section
      className="case-hero-attorney"
      style={{
        background: 'var(--paper, #FFFFFF)',
        border: '1px solid rgba(10,77,60,0.18)',
        borderRadius: 14,
        padding: '20px 24px',
        marginBottom: '1.5rem',
        color: 'var(--ink, #14201B)'
      }}
    >
      <div style={{
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--emerald-deep, #0A4D3C)',
        marginBottom: 10,
        fontWeight: 600
      }}>
        Drafting attorney
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 16,
        alignItems: 'start'
      }}>
        {attorney && (
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted, #5C6862)', marginBottom: 3 }}>
              Attorney
            </div>
            <div style={{
              fontFamily: '"Fraunces", "Cormorant Garamond", Georgia, serif',
              fontSize: 20,
              fontWeight: 500,
              lineHeight: 1.25,
              wordBreak: 'break-word',
              color: 'var(--ink, #14201B)'
            }}>
              {attorney.value}
            </div>
            {barNumber && barNumber.value && (
              <div style={{ fontSize: 11, color: 'var(--muted, #5C6862)', marginTop: 4 }}>
                Bar #{barNumber.value}
              </div>
            )}
          </div>
        )}

        {firm && (
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted, #5C6862)', marginBottom: 3 }}>
              Firm
            </div>
            <div style={{
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.35,
              wordBreak: 'break-word',
              color: 'var(--ink, #14201B)'
            }}>
              {firm.value}
            </div>
            {firmAddress && firmAddress.value && (
              <div style={{
                fontSize: 12,
                color: 'var(--ink-soft, #3C4A43)',
                marginTop: 4,
                lineHeight: 1.4,
                wordBreak: 'break-word'
              }}>
                {firmAddress.value}
              </div>
            )}
            {firmPhone && firmPhone.value && (
              <div style={{ fontSize: 12, color: 'var(--ink-soft, #3C4A43)', marginTop: 3 }}>
                {firmPhone.value}
              </div>
            )}
          </div>
        )}
      </div>

      {primarySource && primarySourceUrl && (() => {
        const src = sourceFor(primarySource);
        if (!src) return null;
        return (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(10,77,60,0.12)' }}>
            <Link
              href={primarySourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 11,
                color: 'var(--emerald-deep, #0A4D3C)',
                textDecoration: 'underline',
                textDecorationColor: 'rgba(10,77,60,0.35)',
                textUnderlineOffset: 2
              }}
            >
              Pulled from {src.docName}{src.page ? ` · p.${src.page}` : ''} →
            </Link>
          </div>
        );
      })()}
    </section>
  );
}
