/**
 * components/case/SectionText.tsx  (val 2026-06-12)
 *
 * Renders a body of text and turns every "§5.A", "§6.G(2)", "Section 2.C"
 * reference into a clickable anchor that deep-links to the page in the case's
 * indexed trust/will/POA PDF (via the byte-serve endpoint with #page=N).
 *
 * Inputs:
 *   - text:        the raw body to render
 *   - documentUrl: the byte-serve URL for the doc (e.g. /api/admin/av/cases/1/documents/3
 *                  for operator, or the client equivalent). null → render plain.
 *   - sectionIndex: {sectionKey: pageNumber} map from the doc row. null → render plain.
 *
 * Server component: no client JS needed; anchors are plain <a> with target=_blank.
 * Style is theme-agnostic — uses currentColor for the link with an underline so
 * it inherits the cream/dark surface it's mounted on.
 */
import { findSectionReferences } from '@/lib/case/pdf_section_index';

interface Props {
  text: string | null | undefined;
  documentUrl: string | null;
  sectionIndex: Record<string, number> | null;
  /** Optional override CSS class for the wrapping span. */
  className?: string;
  /** Optional inline style for the wrapping span. */
  style?: React.CSSProperties;
}

export default function SectionText({ text, documentUrl, sectionIndex, className, style }: Props) {
  if (!text) return null;

  // No doc URL or no index → render plain text (no anchors). Keeps the renderer
  // safe to mount everywhere; surfaces gracefully degrade.
  if (!documentUrl || !sectionIndex || Object.keys(sectionIndex).length === 0) {
    return (
      <span className={className} style={style}>
        {text}
      </span>
    );
  }

  const refs = findSectionReferences(text);
  if (refs.length === 0) {
    return (
      <span className={className} style={style}>
        {text}
      </span>
    );
  }

  // Walk the references in order, building alternating plain-text + anchor
  // segments. References that aren't in the index render as plain text (we
  // don't fabricate a link to a page we don't know).
  const segments: React.ReactNode[] = [];
  let cursor = 0;
  refs.forEach((ref, i) => {
    if (ref.start > cursor) {
      segments.push(text.slice(cursor, ref.start));
    }
    const page = sectionIndex[ref.key];
    if (page) {
      segments.push(
        <a
          key={`ref-${i}-${ref.start}`}
          href={`${documentUrl}#page=${page}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'currentColor',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
            textDecorationStyle: 'dotted',
            fontWeight: 500
          }}
          title={`Open ${ref.raw} (page ${page})`}
        >
          {ref.raw}
        </a>
      );
    } else {
      segments.push(ref.raw);
    }
    cursor = ref.end;
  });
  if (cursor < text.length) {
    segments.push(text.slice(cursor));
  }

  return (
    <span className={className} style={style}>
      {segments}
    </span>
  );
}
