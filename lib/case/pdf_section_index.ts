/**
 * lib/case/pdf_section_index.ts  (val 2026-06-12, v2 — unpdf)
 *
 * Builds a { sectionKey: pageNumber } map from a trust/will/POA PDF so the
 * client + operator dashboards can deep-link "§6.G(2)" straight to the page
 * where it lives. The PDF byte-serve endpoint accepts an `#page=N` URL
 * fragment (Chrome/Edge/Safari/Firefox all support it on application/pdf).
 *
 * Why unpdf (not pdfjs-dist directly): pdfjs-dist 4.x's "fake worker"
 * dynamic-imports a sibling .mjs that gets tree-shaken out of Netlify's
 * serverless bundle. We spent three commits fighting workerSrc, external
 * node_modules, and included_files configs without success. unpdf wraps
 * pdfjs-dist for serverless runtimes and skips the worker entirely.
 *
 * The scan runs once at upload time (or on demand via /reindex). Output is
 * persisted to case_documents.section_index. NULL = never indexed. {} = scanned
 * but nothing matched (so we know not to retry).
 *
 * Section regex matches the common legal-citation shapes that appear in
 * trust / estate-plan documents:
 *   §5.A           — section + paragraph
 *   §5.C(1)        — section + paragraph + subitem
 *   §6.G(2)        — same with multi-digit-letter combos
 *   §2.C           — short form
 *   Section 5.A    — long form (treated as a §5.A alias)
 *
 * We DON'T match free-form references like "Section 5 of the trust" because
 * those don't pin to a specific paragraph. Goal is precision, not recall.
 */

// TWO regexes, because the PDF body and operator analysis text use different
// conventions:
//
//   ANALYSIS_REGEX — for parsing operator/Adriana text in action items and
//     synopsis. Requires the literal § marker or the word "Section " so we
//     only link explicit references, not coincidental "5.A" mentions.
//
//   PDF_SCAN_REGEX — for scanning the trust PDF itself. Real trust documents
//     print section headers as bare "5.A" or "5.A." — no § symbol. We allow
//     the § OR a word boundary, but we still anchor on uppercase letter so
//     things like "version 2.5" don't match.
const ANALYSIS_REGEX = /(?:§\s*|Section\s+)(\d+)\.([A-Z])(?:\s*\((\d+)\))?/g;
const PDF_SCAN_REGEX = /(?:§\s*|\b)(\d+)\.([A-Z])(?:\s*\((\d+)\))?(?=[.\s]|$)/g;

// Legacy name kept for back-compat with any external callers that reference
// it via barrel imports.
const SECTION_REGEX = ANALYSIS_REGEX;

/** Normalize whatever the regex captured into a canonical key like "6.G(2)". */
export function normalizeSectionKey(major: string, letter: string, sub: string | null): string {
  return sub ? `${major}.${letter}(${sub})` : `${major}.${letter}`;
}

export interface SectionIndex {
  /** Map of canonical section key -> 1-indexed page number where it FIRST appears. */
  pages: Record<string, number>;
  /** Total pages scanned. */
  pageCount: number;
  /** True when the scan ran but the file isn't readable as a PDF. */
  unreadable: boolean;
  /** When unreadable, the raw error class + message — surfaces to the operator
   *  so we can diagnose vs. assume it's encryption. */
  errorClass?: string;
  errorMessage?: string;
}

/** Scan a PDF buffer and return the section index. */
export async function buildSectionIndex(bytes: Buffer): Promise<SectionIndex> {
  if (!bytes || bytes.length === 0) {
    return { pages: {}, pageCount: 0, unreadable: true };
  }

  try {
    // Dynamic import keeps the bundle slim for callers that never scan.
    const { extractText, getDocumentProxy } = await import('unpdf');

    const uint8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const doc = await getDocumentProxy(uint8);
    const pageCount = doc.numPages;

    // mergePages: false returns text as an array of per-page strings, which is
    // exactly what we need — the index of the array IS the page number (0-based).
    const result = await extractText(doc, { mergePages: false });
    const pageTexts: string[] = Array.isArray(result.text) ? result.text : [String(result.text)];

    const pages: Record<string, number> = {};
    pageTexts.forEach((rawText, idx) => {
      const pageNum = idx + 1; // PDF page numbers are 1-indexed
      const stripped = (rawText || '').replace(/\s+/g, ' ');

      // PDF body uses bare "5.A" or "5.A." — the loose regex.
      let match: RegExpExecArray | null;
      const regex = new RegExp(PDF_SCAN_REGEX.source, 'g');
      while ((match = regex.exec(stripped)) !== null) {
        const key = normalizeSectionKey(match[1], match[2], match[3] ?? null);
        if (!(key in pages)) {
          pages[key] = pageNum;
        }
      }
    });

    return { pages, pageCount, unreadable: false };
  } catch (err) {
    const e = err as Error;
    return {
      pages: {},
      pageCount: 0,
      unreadable: true,
      errorClass: e?.name || 'UnknownError',
      errorMessage: e?.message || String(err)
    };
  }
}

/** Parse a chunk of body text and return an array of { sectionKey, start, end }
 *  for every section reference found. Used by the renderer to wrap §X.Y in
 *  anchor tags. We re-export the regex shape via a fresh closure so callers
 *  don't share state.
 */
export interface SectionRef {
  /** Canonical key, e.g. "6.G(2)" */
  key: string;
  /** Index in the source string where the match starts. */
  start: number;
  /** Index in the source string where the match ends (exclusive). */
  end: number;
  /** The full matched text as it appeared in the body, e.g. "§6.G(2)" */
  raw: string;
}

export function findSectionReferences(body: string): SectionRef[] {
  if (!body) return [];
  // Analysis text always uses §X.Y or "Section X.Y" — strict regex.
  const regex = new RegExp(ANALYSIS_REGEX.source, 'g');
  const out: SectionRef[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    out.push({
      key: normalizeSectionKey(match[1], match[2], match[3] ?? null),
      start: match.index,
      end: match.index + match[0].length,
      raw: match[0]
    });
  }
  return out;
}
