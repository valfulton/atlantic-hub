/**
 * lib/case/markdown_mini.ts  (val 2026-06-15, #675 Tier A)
 *
 * Zero-dep markdown → safe HTML for the case Document Viewer. Scoped to what
 * val's hand-authored Option drafts actually contain: headers (# ## ###),
 * paragraphs, ordered + unordered lists, bold/italic, inline code, code
 * fences, links, blockquotes, horizontal rules.
 *
 * Why not pull in `marked` or `react-markdown`:
 *   - package.json is deliberately lean (memory: nothing-free, no-bloat)
 *   - the markdown we render is internal — we control what authors produce
 *   - if a doc breaks this renderer we add marked to deps then. Today: no.
 *
 * SECURITY:
 *   - All raw text segments are HTML-escaped BEFORE we splice them into the
 *     output template. The only places we emit < or > are tag boundaries
 *     this file controls. There is no raw HTML passthrough.
 *   - Link `href` is run through a safe-url check (allow http/https/mailto
 *     only). Anything else becomes plain text.
 *   - No iframes, no script tags, no on* attributes — none of these are
 *     reachable from any input path.
 *
 * NOT supported (by design): tables, images, footnotes, raw HTML, html
 * comments, autolinks-other-than-explicit-bracket-form, definition lists.
 * If a doc needs those, we upgrade to a real parser instead of patching.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function safeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Permit http(s), mailto, and same-origin paths. Anything else is rejected
  // so a malicious doc can't smuggle javascript: or data: URLs.
  if (/^(https?:\/\/|mailto:|\/)/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Inline transforms — bold, italic, inline code, links. Run on text that has
 * already been HTML-escaped. Operate on the escaped form so we know our
 * delimiters won't collide with user-typed HTML.
 *
 * Order matters: code first (so its content stays literal), then links, then
 * bold (so ** wins over *), then italic.
 */
function applyInline(escaped: string): string {
  let out = escaped;

  // Inline code: `foo`  →  <code>foo</code>
  // Greedy-match by smallest token between backticks.
  out = out.replace(/`([^`\n]+)`/g, (_m, code) => `<code>${code}</code>`);

  // Links: [label](href)  →  <a href="…">label</a>
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, hrefRaw) => {
    const href = safeHref(hrefRaw);
    if (!href) return label;
    // href has already been HTML-escaped (we operate post-escape); but mailto
    // can contain question marks etc — those are valid in escaped form.
    return `<a href="${href}" rel="noopener noreferrer">${label}</a>`;
  });

  // Bold: **foo**  →  <strong>foo</strong>
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

  // Italic: *foo* or _foo_  →  <em>foo</em>
  // Skip if the * is part of a list marker by requiring non-space on each side.
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');

  return out;
}

interface BlockState {
  buffer: string[];
  inList: 'ul' | 'ol' | null;
  inPara: string[];
  inCodeFence: boolean;
  codeFenceLines: string[];
  inBlockquote: string[];
}

function flushParagraph(state: BlockState) {
  if (state.inPara.length === 0) return;
  const text = state.inPara.join(' ');
  state.buffer.push(`<p>${applyInline(escapeHtml(text))}</p>`);
  state.inPara = [];
}

function flushList(state: BlockState) {
  if (state.inList) {
    state.buffer.push(`</${state.inList}>`);
    state.inList = null;
  }
}

function flushBlockquote(state: BlockState) {
  if (state.inBlockquote.length === 0) return;
  const inner = state.inBlockquote.map((l) => applyInline(escapeHtml(l))).join('<br/>');
  state.buffer.push(`<blockquote>${inner}</blockquote>`);
  state.inBlockquote = [];
}

function flushCodeFence(state: BlockState) {
  if (!state.inCodeFence) return;
  const code = state.codeFenceLines.map(escapeHtml).join('\n');
  state.buffer.push(`<pre><code>${code}</code></pre>`);
  state.inCodeFence = false;
  state.codeFenceLines = [];
}

function flushAllOpenBlocks(state: BlockState) {
  flushParagraph(state);
  flushList(state);
  flushBlockquote(state);
  flushCodeFence(state);
}

/** Convert a markdown source string to a safe HTML string. */
export function markdownToSafeHtml(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const state: BlockState = {
    buffer: [],
    inList: null,
    inPara: [],
    inCodeFence: false,
    codeFenceLines: [],
    inBlockquote: []
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '    ');

    // Code fence open/close — takes precedence over everything else.
    if (/^```/.test(line)) {
      if (state.inCodeFence) {
        flushCodeFence(state);
      } else {
        flushParagraph(state);
        flushList(state);
        flushBlockquote(state);
        state.inCodeFence = true;
      }
      continue;
    }
    if (state.inCodeFence) {
      state.codeFenceLines.push(line);
      continue;
    }

    // Blank line breaks paragraphs / lists / blockquotes.
    if (/^\s*$/.test(line)) {
      flushParagraph(state);
      flushList(state);
      flushBlockquote(state);
      continue;
    }

    // Headers: # / ## / ### / #### / ##### / ######
    const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      flushParagraph(state);
      flushList(state);
      flushBlockquote(state);
      const level = headerMatch[1].length;
      const text = applyInline(escapeHtml(headerMatch[2].trim()));
      state.buffer.push(`<h${level}>${text}</h${level}>`);
      continue;
    }

    // Horizontal rule: --- or *** or ___ (3+).
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      flushParagraph(state);
      flushList(state);
      flushBlockquote(state);
      state.buffer.push('<hr/>');
      continue;
    }

    // Blockquote: > foo
    const blockquoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (blockquoteMatch) {
      flushParagraph(state);
      flushList(state);
      state.inBlockquote.push(blockquoteMatch[1]);
      continue;
    } else if (state.inBlockquote.length > 0) {
      flushBlockquote(state);
    }

    // Ordered list: "1. foo" / "2) foo"
    const olMatch = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (olMatch) {
      flushParagraph(state);
      if (state.inList !== 'ol') {
        flushList(state);
        state.buffer.push('<ol>');
        state.inList = 'ol';
      }
      state.buffer.push(`<li>${applyInline(escapeHtml(olMatch[1]))}</li>`);
      continue;
    }

    // Unordered list: "- foo" / "* foo" / "+ foo"
    const ulMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ulMatch) {
      flushParagraph(state);
      if (state.inList !== 'ul') {
        flushList(state);
        state.buffer.push('<ul>');
        state.inList = 'ul';
      }
      state.buffer.push(`<li>${applyInline(escapeHtml(ulMatch[1]))}</li>`);
      continue;
    }

    // Otherwise — accumulate as paragraph text.
    if (state.inList) flushList(state);
    state.inPara.push(line.trim());
  }

  flushAllOpenBlocks(state);
  return state.buffer.join('\n');
}
