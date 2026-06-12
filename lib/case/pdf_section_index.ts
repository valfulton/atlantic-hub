/**
 * lib/case/pdf_section_index.ts  (val 2026-06-12)
 *
 * Builds a { sectionKey: pageNumber } map from a trust/will/POA PDF so the
 * client + operator dashboards can deep-link "§6.G(2)" straight to the page
 * where it lives. The PDF byte-serve endpoint accepts an `#page=N` URL
 * fragment (Chrome/Edge/Safari/Firefox all support it on application/pdf).
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
 *
 * No external network; pure server-side pdfjs-dist text extraction.
 */

// Pattern: optional "§" or "Section ", then 1+ digits, ".", an uppercase letter,
// optionally followed by "(N)" subitem. We capture the section key without §.
const SECTION_REGEX = /(?:§\s*|Section\s+)(\d+)\.([A-Z])(?:\s*\((\d+)\))?/g;

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

/** Scan a PDF buffer and return the section index.
 *
 *  Uses the LEGACY pdfjs-dist build because the modern build assumes a browser
 *  worker. Legacy works in Node out of the box. We dynamically import so the
 *  bundle stays slim for callers that never run a scan.
 */
export async function buildSectionIndex(bytes: Buffer): Promise<SectionIndex> {
  if (!bytes || bytes.length === 0) {
    return { pages: {}, pageCount: 0, unreadable: true };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore resolved at runtime via package; legacy build is Node-safe.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

    // CRITICAL for Netlify serverless: pdfjs 4.x spins up a "fake worker" by
    // dynamic-importing the worker module. The bundler-mangled URL points at
    // a chunks/ path that doesn't exist on disk, so the import fails with
    // 'Cannot find module .next/server/chunks/pdf.worker.mjs'.
    //
    // Fix: point GlobalWorkerOptions.workerSrc at the worker file inside
    // node_modules. Combined with serverComponentsExternalPackages, this
    // makes the resolution work in deployed functions.
    try {
      const { createRequire } = await import('node:module');
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore import.meta is available in ESM module context at runtime
      const req = createRequire(import.meta.url);
      const workerPath = req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      // pdfjs.GlobalWorkerOptions is the standard config surface.
      if (pdfjs.GlobalWorkerOptions) {
        pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
      }
    } catch (workerErr) {
      // Non-fatal: fall through to fake worker. If that ALSO fails, the outer
      // catch surfaces the real error.
      console.warn('pdfjs worker resolve failed (will try fake worker)', workerErr);
    }

    // pdfjs.getDocument expects a Uint8Array or { data: Uint8Array }
    const uint8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const loadingTask = pdfjs.getDocument({
      data: uint8,
      // Avoid trying to fetch standard fonts from a CDN — we only need text.
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: false
    });
    const doc = await loadingTask.promise;
    const pageCount = doc.numPages;
    const pages: Record<string, number> = {};

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      try {
        const page = await doc.getPage(pageNum);
        const content = await page.getTextContent();
        // Concatenate item strings with spaces. pdfjs sometimes splits a token
        // like "§6.G(2)" across multiple items, so we keep raw + a stripped
        // version (no spaces) and scan both.
        const raw = (content.items as Array<{ str?: string }>)
          .map((item) => item.str || '')
          .join(' ');
        const stripped = raw.replace(/\s+/g, ' ');

        let match: RegExpExecArray | null;
        SECTION_REGEX.lastIndex = 0;
        while ((match = SECTION_REGEX.exec(stripped)) !== null) {
          const key = normalizeSectionKey(match[1], match[2], match[3] ?? null);
          if (!(key in pages)) {
            pages[key] = pageNum;
          }
        }
      } catch {
        // skip a single bad page; keep scanning.
        continue;
      }
    }

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
  const regex = new RegExp(SECTION_REGEX.source, 'g');
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
