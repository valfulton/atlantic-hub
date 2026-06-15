/**
 * components/case/ActionItemDetail.tsx  (val 2026-06-15, #665)
 *
 * Renders an action item's detail body with TWO kinds of clickable links:
 *
 *   1. §-references like §5.A or §6.G(2) — handed off to SectionText so they
 *      deep-link into the indexed trust/will/POA PDF at the right page.
 *
 *   2. Option-letter prefixes like "A — Full Restatement…" or "B — Targeted
 *      Amendment…" — wrapped as links to the corresponding option draft PDF
 *      in case_documents, opened in a new tab. The letter + em-dash + the
 *      rest of the line through the first period is the clickable surface.
 *
 * Why the line-by-line walk: option letters are line-anchored (operator
 * writes one option per line in the detail editor), so we split on \n and
 * inspect each line independently. §-refs inside an option line still
 * render as clickable via the inner SectionText call — they don't nest
 * inside an option anchor because the option link only wraps the prefix
 * (letter + em-dash), not the full line.
 *
 * Universal: this works for any case whose documents follow the
 *   "Option_<A-E>_<anything>" naming pattern. Operator-uploaded option
 *   drafts are picked up by scanning document names; no per-case wiring.
 */
import SectionText from './SectionText';

export interface OptionDocRef {
  documentId: number;
  documentName: string;
}

interface Props {
  text: string;
  /** Byte-serve URL prefix for §-ref deep links. */
  documentUrl: string | null;
  /** {sectionKey: pageNumber} from the indexed trust/will PDF. */
  sectionIndex: Record<string, number> | null;
  /** {A: doc, B: doc, ...} — letter → option draft document, if uploaded. */
  optionDocs?: Record<string, OptionDocRef | undefined>;
  /** Case id used to build the byte-serve URL for the option draft anchor. */
  caseId: number;
}

const OPTION_LINE = /^( *)([A-E])\s+—\s+(.*)$/;

export default function ActionItemDetail({
  text,
  documentUrl,
  sectionIndex,
  optionDocs,
  caseId
}: Props) {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <div style={{ whiteSpace: 'pre-wrap' }}>
      {lines.map((line, i) => {
        const m = line.match(OPTION_LINE);
        const doc = m && optionDocs?.[m[2].toUpperCase()];
        const tail = i < lines.length - 1 ? '\n' : '';

        if (m && doc) {
          const indent = m[1];
          const letter = m[2];
          const rest = m[3];
          const href = `/api/admin/av/cases/${caseId}/documents/${doc.documentId}`;
          return (
            <span key={i}>
              {indent}
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--emerald-deep, #0A4D3C)',
                  fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif',
                  fontWeight: 600,
                  textDecoration: 'none',
                  borderBottom: '1px solid rgba(10,77,60,0.55)',
                  paddingBottom: '1px',
                  whiteSpace: 'nowrap'
                }}
                title={`Open Option ${letter} draft (${doc.documentName})`}
              >
                {letter} —
              </a>
              {' '}
              <SectionText text={rest} documentUrl={documentUrl} sectionIndex={sectionIndex} />
              {tail}
            </span>
          );
        }

        return (
          <span key={i}>
            <SectionText text={line} documentUrl={documentUrl} sectionIndex={sectionIndex} />
            {tail}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Build the option-letter → document map by scanning case documents.
 * Matches names like:
 *   Option_A_Full_Restatement.md
 *   Option B - Targeted Amendment.pdf
 *   OptionC.pdf
 * Case-insensitive. First match wins per letter (so the operator can
 * sequence drafts and the latest-uploaded sorts last by default).
 */
export function buildOptionDocsMap(
  docs: Array<{ documentId: number; documentName: string }>
): Record<string, OptionDocRef | undefined> {
  const map: Record<string, OptionDocRef | undefined> = {};
  for (const d of docs) {
    const m = d.documentName.match(/^Option[_ \-]?([A-E])/i);
    if (m) {
      const letter = m[1].toUpperCase();
      if (!map[letter]) {
        map[letter] = { documentId: d.documentId, documentName: d.documentName };
      }
    }
  }
  return map;
}
