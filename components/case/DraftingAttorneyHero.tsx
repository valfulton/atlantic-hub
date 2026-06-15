/**
 * components/case/DraftingAttorneyHero.tsx  (val 2026-06-15)
 *
 * Drafting attorney reference card. Surfaces who drafted the operative
 * document (trust, will, contract, deed, etc.) pulled from
 * document_extracts.
 *
 * Originally built as a hero block (#690). val 2026-06-15: "The attorney
 * who did this dirty deal isnt the main event. Her information needs to
 * be displayed but she is no hero and should appear after Adriana." So
 * this now renders as a QUIET sidebar reference card — same visual
 * weight as Property / Parties / Review & Approval — not a hero.
 *
 * Universal: hides itself when no attorney + firm extracts exist, so it
 * works for any case_kind (trust, estate, contract, deed, etc.) and
 * gracefully no-ops on cases that haven't been LLM-scanned.
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
  /** URL pattern for opening the source document. */
  documentViewerUrlFor: (documentId: number, pageNumber: number | null) => string;
  /**
   * Surface label override. Family + operator both default to "Trust
   * drafted by" (lower-key than the old "Drafting attorney" header).
   */
  label?: string;
}

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

export default function DraftingAttorneyHero({
  caseId: _caseId,
  extracts,
  documents,
  documentViewerUrlFor,
  label = 'Trust drafted by'
}: Props) {
  const attorney = findExtract(extracts, 'attorney', /drafting|primary/i)
    || findExtract(extracts, 'attorney');
  const firm = findExtract(extracts, 'firm', /drafting|primary/i)
    || findExtract(extracts, 'firm');
  const firmAddress = findExtract(extracts, 'address', /firm/i);
  const firmPhone = findExtract(extracts, 'contact', /firm|phone/i);
  const barNumber = findExtract(extracts, 'bar_number');

  if (!attorney && !firm) return null;

  const docMap = new Map<number, string>();
  for (const d of documents) docMap.set(d.documentId, d.documentName);

  const primarySource = attorney || firm;
  const primarySourceUrl = primarySource
    ? documentViewerUrlFor(primarySource.documentId, primarySource.pageNumber)
    : null;
  const primarySourceName = primarySource
    ? docMap.get(primarySource.documentId)?.replace(/\.[a-z]+$/i, '') || null
    : null;

  // (val 2026-06-15) Match the .panel chrome other sidebar cards use so
  // this looks like a peer of Property + Parties + Review & Approval —
  // not a hero. Caller mounts inside the same sidebar so .panel CSS
  // tokens are in scope.
  return (
    <div className="panel">
      <p className="panel-h">{label}</p>
      {attorney && (
        <div style={{ marginBottom: firm ? 10 : 4 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink, #14201B)', lineHeight: 1.3, wordBreak: 'break-word' }}>
            {attorney.value}
          </div>
          {barNumber && barNumber.value && (
            <div style={{ fontSize: 11, color: 'var(--muted, #5C6862)', marginTop: 2 }}>
              Bar #{barNumber.value}
            </div>
          )}
        </div>
      )}
      {firm && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--muted, #5C6862)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
            Firm
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink, #14201B)', wordBreak: 'break-word', lineHeight: 1.35 }}>
            {firm.value}
          </div>
          {firmAddress && firmAddress.value && (
            <div style={{ fontSize: 12, color: 'var(--ink-soft, #3C4A43)', marginTop: 3, lineHeight: 1.4, wordBreak: 'break-word' }}>
              {firmAddress.value}
            </div>
          )}
          {firmPhone && firmPhone.value && (
            <div style={{ fontSize: 12, color: 'var(--ink-soft, #3C4A43)', marginTop: 2 }}>
              {firmPhone.value}
            </div>
          )}
        </div>
      )}
      {primarySource && primarySourceUrl && primarySourceName && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(10,77,60,0.12)' }}>
          <Link
            href={primarySourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 10,
              color: 'var(--muted, #5C6862)',
              textDecoration: 'underline',
              textDecorationColor: 'rgba(10,77,60,0.25)',
              textUnderlineOffset: 2,
              letterSpacing: '0.04em'
            }}
          >
            {primarySourceName}{primarySource.pageNumber ? ` · p.${primarySource.pageNumber}` : ''} →
          </Link>
        </div>
      )}
    </div>
  );
}
