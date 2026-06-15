/**
 * components/case/FamilyFindingsPanel.tsx  (val 2026-06-15, #669)
 *
 * Family-facing read of document findings. Mounts on /client/cases/[caseId]
 * (Rebecca / parents / Adriana view) and on the operator preview mirror.
 *
 * HARD RULES (per memory):
 *   - Adriana is the attribution voice (Legal Document Assistant). She
 *     "noted" the items — no mention of scanner, AI, LLM, model name.
 *   - Severity is translated to human language ("Needs attention" not
 *     "urgent"; no engine pill colors as primary signal).
 *   - oddity_type, model_id, and document_id are NOT shown.
 *   - Content (quote + note) is VERBATIM from the operator finding.
 *   - Empty state hides the panel entirely (no scaffolding without content).
 *
 * Visibility gate is upstream — this component receives only findings the
 * operator flipped to family_visible. The query is in
 * lib/case/document_findings_store.ts (listFamilyVisibleFindingsForCase).
 */
import type { DocumentFinding } from '@/lib/case/document_findings_store';

interface CaseDocLite {
  documentId: number;
  documentName: string;
  documentKind: string | null;
}

interface Props {
  /** Only family_visible rows, already ordered by severity. */
  findings: DocumentFinding[];
  /** Documents on this case, so we can show which doc each finding came from. */
  documents: CaseDocLite[];
  /** Who's reviewing the documents — display name + role. */
  reviewerName?: string | null;
  /** Optional review date for the attribution line. ISO string. */
  reviewedAt?: string | null;
  /**
   * Byte-serve URL for the indexable document (typically the trust). When
   * present, "page N" / "Section X" labels become clickable links opening
   * the PDF at the right page in a new tab. (#670)
   */
  indexableDocumentUrl?: string | null;
  /** Document id of the indexable doc — used to only link findings that
   *  belong to that document. */
  indexableDocumentId?: number | null;
}

function familyLabel(sev: DocumentFinding['severity']): { text: string; tone: string } {
  if (sev === 'urgent') return { text: 'Needs attention', tone: '#8E2A2A' };
  if (sev === 'high') return { text: 'Worth reviewing', tone: '#7A5A18' };
  if (sev === 'info') return { text: 'For your information', tone: '#5C6862' };
  return { text: 'Note', tone: '#0A4D3C' };
}

function whereLabel(doc: CaseDocLite | undefined, f: DocumentFinding): string {
  const parts: string[] = [];
  if (f.sectionKey) parts.push(`Section ${f.sectionKey}`);
  if (f.pageNumber) parts.push(`page ${f.pageNumber}`);
  if (doc) parts.push(`of ${doc.documentName.replace(/\.[a-z]+$/i, '')}`);
  return parts.join(' · ');
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  } catch {
    return '';
  }
}

export default function FamilyFindingsPanel({
  findings,
  documents,
  reviewerName,
  reviewedAt,
  indexableDocumentUrl,
  indexableDocumentId
}: Props) {
  if (!findings || findings.length === 0) return null;

  const docMap = new Map<number, CaseDocLite>();
  for (const d of documents) docMap.set(d.documentId, d);

  /** Build a hyperlink to the PDF at a specific page, when we have both a
   *  byte-serve URL and a page number AND the finding belongs to the
   *  indexable document. Falls back to plain text. */
  function refLink(f: DocumentFinding, label: string) {
    if (!indexableDocumentUrl) return <>{label}</>;
    if (indexableDocumentId != null && f.documentId !== indexableDocumentId) return <>{label}</>;
    if (!f.pageNumber) return <>{label}</>;
    return (
      <a
        href={`${indexableDocumentUrl}#page=${f.pageNumber}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: 'var(--emerald-deep, #0A4D3C)',
          textDecoration: 'underline',
          textDecorationStyle: 'dotted',
          textUnderlineOffset: 3,
          textDecorationColor: 'var(--emerald-deep, #0A4D3C)'
        }}
        title="Open the document at this page"
      >
        {label}
      </a>
    );
  }

  // (val 2026-06-15) Findings are flagged by the document scanner — NOT by
  // Adriana or any specific person. Earlier copy attributed them to a
  // reviewer name, which was wrong: val confirmed nobody hand-flagged
  // them. Keep the header attribution-free; date stays as light context.
  void reviewerName;
  const dateLine = reviewedAt ? ` · Noted ${fmtDate(reviewedAt)}` : '';

  // (val 2026-06-15, #692) The whole "Notes on your documents" section
  // is now collapsible like Outstanding items / Timeline / Awaiting your
  // decision. Default CLOSED — these are reference, not the next action.
  // Each finding inside the body gets a proper card (white surface +
  // gold-deep top accent + soft shadow) so the "Worth Reviewing" /
  // "Note" / "For Your Information" headlines lead their own card,
  // instead of looking like list items inside a single big section.
  return (
    <section className="av-panel av-panel--cream" style={{ marginTop: 24 }}>
      <details className="case-findings-collapse">
        <summary
          style={{
            cursor: 'pointer',
            listStyle: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 14
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              className="case-findings-chev"
              aria-hidden="true"
              style={{
                fontSize: 18,
                lineHeight: 1,
                color: 'var(--ink, #1a1a1a)',
                transition: 'transform 0.18s ease',
                display: 'inline-block',
                transform: 'rotate(-90deg)'
              }}
            >
              ▾
            </span>
            <h2
              style={{
                fontFamily: 'var(--font-fraunces, Fraunces, serif)',
                fontSize: 22,
                fontWeight: 500,
                color: 'var(--ink, #1a1a1a)',
                letterSpacing: '-0.01em',
                margin: 0
              }}
            >
              Notes on your documents <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--muted, #5C6862)' }}>({findings.length})</span>
            </h2>
          </div>
        </summary>

        <style>{`
          .case-findings-collapse[open] .case-findings-chev { transform: rotate(0deg) !important; }
          .case-findings-collapse > summary::-webkit-details-marker { display: none; }
          .case-findings-collapse > summary::marker { content: ''; }
          .case-findings-collapse > summary:hover .case-findings-chev { opacity: 0.7; }
        `}</style>

        <p
          style={{
            fontSize: 14,
            color: 'var(--muted, #5C6862)',
            margin: '0 0 18px 0',
            lineHeight: 1.5
          }}
        >
          A few clauses to keep in mind as you read through your file.
          {dateLine}
        </p>

        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {findings.map((f) => {
          const label = familyLabel(f.severity);
          const where = whereLabel(docMap.get(f.documentId), f);
          return (
            <li
              key={f.findingId}
              style={{
                // (val 2026-06-15, #692) Each finding is its own card —
                // white surface, soft border, top accent stripe colored
                // by severity, proper drop shadow so it reads as a
                // distinct card not a list row. The headline label
                // ("Worth reviewing" / "Note" / "For Your Information")
                // sits ON the card, not in a shared scroll of items.
                background: '#FFFFFF',
                border: '1px solid rgba(10,10,10,0.08)',
                borderTop: `3px solid ${label.tone}`,
                boxShadow: '0 1px 3px rgba(10,10,10,0.04), 0 8px 24px -16px rgba(10,10,10,0.08)',
                padding: '18px 22px',
                marginBottom: 16,
                borderRadius: 10
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 10,
                  flexWrap: 'wrap',
                  marginBottom: 10
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: label.tone
                  }}
                >
                  {label.text}
                </span>
                {where && (
                  <span
                    style={{
                      fontSize: 12,
                      color: 'var(--muted, #5C6862)',
                      fontFamily: 'var(--font-fraunces, Fraunces, serif)',
                      fontStyle: 'italic'
                    }}
                  >
                    {where}
                  </span>
                )}
              </div>

              {/* Clickable jump-to-page link rendered separately so the
                  `where` line above stays plain-italic for legibility. */}
              {f.pageNumber && indexableDocumentUrl && (indexableDocumentId == null || f.documentId === indexableDocumentId) && (
                <div style={{ marginBottom: 8 }}>
                  {refLink(f, `Open the document at page ${f.pageNumber} →`)}
                </div>
              )}

              {f.quote && (
                <blockquote
                  style={{
                    fontFamily: 'var(--font-fraunces, Fraunces, serif)',
                    fontStyle: 'italic',
                    fontSize: 16,
                    color: 'var(--ink, #1a1a1a)',
                    lineHeight: 1.55,
                    borderLeft: '2px solid rgba(10,10,10,0.12)',
                    paddingLeft: 14,
                    margin: '0 0 10px 0'
                  }}
                >
                  &ldquo;{f.quote}&rdquo;
                </blockquote>
              )}

              {f.llmNote && (
                <p
                  style={{
                    fontSize: 15,
                    color: 'var(--ink, #1a1a1a)',
                    lineHeight: 1.6,
                    margin: 0
                  }}
                >
                  {f.llmNote}
                </p>
              )}
            </li>
          );
        })}
      </ul>

        <p
          style={{
            fontSize: 13,
            color: 'var(--muted, #5C6862)',
            marginTop: 18,
            lineHeight: 1.5,
            fontStyle: 'italic'
          }}
        >
          These are observations, not legal advice. Bring any of them to a
          licensed attorney before you decide how to act on them.
        </p>
      </details>
    </section>
  );
}
