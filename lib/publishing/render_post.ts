/**
 * lib/publishing/render_post.ts
 *
 * Renders an approved content artifact into a self-contained HTML post page that
 * mirrors Atlantic & Vine's "The Journal" blog template
 * (atlanticandvine.netlify.app/_blog-post-template): editorial serif headline,
 * category eyebrow, byline, drop-cap body, pull-quotes, and a packages CTA.
 *
 * It is intentionally SELF-CONTAINED (inline CSS, web fonts) so the committed
 * file renders correctly on the static site regardless of the site's shared
 * layout. Light editorial palette to match the live /blog cards.
 *
 * Body is the same light Markdown-ish text the newsroom renders; we reuse a
 * compact block parser here (## headings, > quotes, - lists, paragraphs).
 */

interface Block {
  kind: 'h2' | 'quote' | 'ul' | 'p';
  text?: string;
  items?: string[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s: string): string {
  // bold/italic -> strong/em, after escaping; strip stray markdown.
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
    .replace(/`/g, '');
}

function toBlocks(body: string): Block[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushP = () => { if (para.length) { blocks.push({ kind: 'p', text: para.join(' ') }); para = []; } };
  const flushL = () => { if (list.length) { blocks.push({ kind: 'ul', items: list.slice() }); list = []; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushP(); flushL(); continue; }
    if (/^>\s?/.test(line)) { flushP(); flushL(); blocks.push({ kind: 'quote', text: line.replace(/^>\s?/, '') }); }
    else if (/^#{1,6}\s/.test(line)) { flushP(); flushL(); blocks.push({ kind: 'h2', text: line.replace(/^#{1,6}\s+/, '') }); }
    else if (/^[-*]\s+/.test(line)) { flushP(); list.push(line.replace(/^[-*]\s+/, '')); }
    else { flushL(); para.push(line); }
  }
  flushP(); flushL();
  return blocks;
}

function renderBlocks(blocks: Block[]): string {
  return blocks
    .map((b, i) => {
      if (b.kind === 'h2') return `<h2>${inline(b.text ?? '')}</h2>`;
      if (b.kind === 'quote') return `<blockquote>${inline(b.text ?? '')}</blockquote>`;
      if (b.kind === 'ul') return `<ul>${(b.items ?? []).map((it) => `<li>${inline(it)}</li>`).join('')}</ul>`;
      // first paragraph gets the drop cap
      const cls = i === 0 ? ' class="lead"' : '';
      return `<p${cls}>${inline(b.text ?? '')}</p>`;
    })
    .join('\n');
}

/**
 * Marker comments the operator adds ONCE inside their /blog cards grid. The
 * connector inserts new cards right after START (newest first) and never touches
 * anything outside the markers, so the existing hand-built grid is preserved.
 */
export const BLOG_CARDS_START = '<!-- HUB:POSTS:START -->';
export const BLOG_CARDS_END = '<!-- HUB:POSTS:END -->';

/** Category -> header gradient, approximating the live /blog cards. */
const CATEGORY_GRADIENT: Record<string, string> = {
  PR: 'linear-gradient(135deg,#0e5a63,#0b3b46)',
  ADVERTISING: 'linear-gradient(135deg,#ff7a59,#ff5a6e)',
  GROWTH: 'linear-gradient(135deg,#1f8a5b,#0e5a40)',
  'CASE STUDY': 'linear-gradient(135deg,#9a8b3f,#5a6b2e)',
  INTELLIGENCE: 'linear-gradient(135deg,#0e8a7b,#1f8a5b)',
  'FIELD NOTES': 'linear-gradient(135deg,#f6c244,#ff9c5b)',
  JOURNAL: 'linear-gradient(135deg,#0e5a63,#0b3b46)'
};

export interface BlogCardInput {
  href: string;
  title: string;
  excerpt?: string | null;
  category?: string | null;
  readMinutes?: number | null;
}

/** A single card matching the live /blog grid, self-styled so it needs no site CSS. */
export function renderBlogCard(input: BlogCardInput): string {
  const cat = (input.category || 'Journal').toUpperCase();
  const grad = CATEGORY_GRADIENT[cat] || CATEGORY_GRADIENT.JOURNAL;
  const mins = input.readMinutes && input.readMinutes > 0 ? input.readMinutes : 4;
  return `<a href="${esc(input.href)}" style="display:block;text-decoration:none;color:inherit;border:1px solid #ece7dd;border-radius:16px;overflow:hidden;background:#fff;">
  <div style="position:relative;height:160px;background:${grad};">
    <span style="position:absolute;top:14px;left:14px;background:#fff;color:#15202b;font:600 11px/1 Inter,sans-serif;letter-spacing:.06em;padding:6px 10px;border-radius:999px;">${esc(cat)}</span>
  </div>
  <div style="padding:18px 18px 20px;">
    <h3 style="font-family:Fraunces,Georgia,serif;font-weight:600;font-size:20px;line-height:1.2;margin:0 0 8px;color:#15202b;">${esc(input.title)}</h3>
    ${input.excerpt ? `<p style="margin:0 0 14px;color:#5b6b7a;font:400 14px/1.5 Inter,sans-serif;">${esc(input.excerpt)}</p>` : ''}
    <span style="color:#8a97a3;font:500 12px/1 Inter,sans-serif;">${mins} min read</span>
  </div>
</a>`;
}

/** A post entry in the hub-maintained blog manifest (blog/posts.json). */
export interface BlogManifestPost {
  slug: string;
  title: string;
  href: string;
  excerpt?: string | null;
  category?: string | null;
  readMinutes?: number | null;
  date?: string | null;
}

/**
 * Render the FULL /blog index page (head + nav + hero + card grid + footer),
 * self-contained, from the hub manifest. The hub owns this page, so publishing
 * regenerates it -- new posts auto-list, no markers, no manual edits.
 */
export function renderBlogIndexHtml(posts: BlogManifestPost[]): string {
  const cards = posts
    .map((p) =>
      renderBlogCard({
        href: p.href,
        title: p.title,
        excerpt: p.excerpt ?? null,
        category: p.category ?? null,
        readMinutes: p.readMinutes ?? null
      })
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>The Journal - Atlantic &amp; Vine</title>
<meta name="description" content="Insights, announcements, and field notes on AI-native marketing from Atlantic & Vine." />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
  * { box-sizing:border-box; }
  body { margin:0; background:#fbf9f4; color:#15202b; font-family:'Inter',system-ui,sans-serif; }
  a { color:inherit; }
  header.site { border-bottom:1px solid #ece7dd; }
  header.site .wrap { max-width:1100px; margin:0 auto; padding:18px 24px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
  header.site nav a { margin-left:22px; color:#15202b; text-decoration:none; font-size:14px; font-weight:500; }
  .brand { font-family:'Fraunces',serif; font-weight:600; font-size:20px; text-decoration:none; color:#15202b; }
  main { max-width:1100px; margin:0 auto; padding:48px 24px 60px; }
  .hero h1 { font-family:'Fraunces',serif; font-weight:600; font-size:clamp(34px,5vw,52px); margin:0 0 10px; }
  .hero p { color:#5b6b7a; font-size:18px; max-width:620px; margin:0 0 36px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:22px; }
  .empty { color:#5b6b7a; }
  footer { max-width:1100px; margin:0 auto; padding:24px; color:#8a97a3; font-size:13px; border-top:1px solid #ece7dd; }
</style>
</head>
<body>
<header class="site">
  <div class="wrap">
    <a class="brand" href="/">Atlantic &amp; Vine</a>
    <nav>
      <a href="/blog">Journal</a>
      <a href="/packages">Packages</a>
      <a href="/audit-form">Free Audit</a>
      <a href="/client-intake">Apply Now</a>
    </nav>
  </div>
</header>
<main>
  <div class="hero">
    <h1>The Journal</h1>
    <p>Insights, announcements, and field notes on AI-native marketing - written from the intelligence we accumulate working with real businesses.</p>
  </div>
  <div class="grid">
    ${cards || '<p class="empty">Fresh stories are on the way.</p>'}
  </div>
</main>
<footer>&copy; ${new Date().getFullYear()} Atlantic And Vine LLC.</footer>
</body>
</html>`;
}

export interface RenderPostInput {
  title: string;
  bodyText: string;
  category?: string | null;
  metaDescription?: string | null;
  readMinutes?: number | null;
  dateLabel?: string | null;
}

export function renderPostHtml(input: RenderPostInput): string {
  const title = input.title || 'Untitled';
  const category = input.category || 'Journal';
  const desc = (input.metaDescription || '').slice(0, 200);
  const date = input.dateLabel || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const mins = input.readMinutes && input.readMinutes > 0 ? input.readMinutes : Math.max(2, Math.round((input.bodyText || '').split(/\s+/).length / 200));
  const body = renderBlocks(toBlocks(input.bodyText || ''));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)} - The Journal - Atlantic &amp; Vine</title>
<meta name="description" content="${esc(desc)}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
  :root { --ink:#15202b; --muted:#5b6b7a; --line:#e7e2d8; --paper:#fbf9f4; --brand1:#FF5A6E; --brand2:#FF9C5B; --sea:#0e5a63; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font-family:'Inter',system-ui,sans-serif; line-height:1.7; }
  a { color:var(--sea); }
  header.site { border-bottom:1px solid var(--line); }
  header.site .wrap { max-width:1100px; margin:0 auto; padding:18px 24px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
  header.site nav a { margin-left:22px; color:var(--ink); text-decoration:none; font-size:14px; font-weight:500; }
  .brand { font-family:'Fraunces',serif; font-weight:600; font-size:20px; text-decoration:none; color:var(--ink); }
  main { max-width:720px; margin:0 auto; padding:56px 24px 40px; }
  .eyebrow { text-transform:uppercase; letter-spacing:.18em; font-size:12px; font-weight:600; color:var(--sea); }
  h1 { font-family:'Fraunces',serif; font-weight:600; font-size:clamp(34px,5vw,52px); line-height:1.08; margin:14px 0 12px; }
  .promise { font-size:20px; color:var(--muted); margin:0 0 22px; }
  .byline { font-size:13px; color:var(--muted); border-top:1px solid var(--line); border-bottom:1px solid var(--line); padding:12px 0; margin-bottom:34px; }
  article p { font-size:18px; margin:0 0 22px; }
  article p.lead::first-letter { font-family:'Fraunces',serif; font-weight:600; font-size:64px; line-height:.8; float:left; padding:6px 10px 0 0; color:var(--ink); }
  article h2 { font-family:'Fraunces',serif; font-weight:600; font-size:28px; margin:38px 0 14px; }
  article ul { padding-left:22px; margin:0 0 22px; }
  article li { margin-bottom:8px; font-size:18px; }
  blockquote { margin:30px 0; padding:6px 0 6px 22px; border-left:3px solid; border-image:linear-gradient(180deg,var(--brand1),var(--brand2)) 1; font-family:'Fraunces',serif; font-size:24px; line-height:1.4; color:var(--ink); }
  .cta { max-width:720px; margin:48px auto 0; padding:30px 24px; border-top:1px solid var(--line); }
  .cta h3 { font-family:'Fraunces',serif; font-weight:600; font-size:24px; margin:0 0 8px; }
  .cta p { color:var(--muted); margin:0 0 16px; }
  .btn { display:inline-block; background:linear-gradient(120deg,var(--brand1),var(--brand2)); color:#fff; text-decoration:none; font-weight:600; padding:12px 22px; border-radius:10px; }
  footer { max-width:1100px; margin:40px auto 0; padding:24px; color:var(--muted); font-size:13px; border-top:1px solid var(--line); }
</style>
</head>
<body>
<header class="site">
  <div class="wrap">
    <a class="brand" href="/">Atlantic &amp; Vine</a>
    <nav>
      <a href="/blog">Journal</a>
      <a href="/packages">Packages</a>
      <a href="/audit-form">Free Audit</a>
      <a href="/client-intake">Apply Now</a>
    </nav>
  </div>
</header>
<main>
  <div class="eyebrow">${esc(category)}</div>
  <h1>${esc(title)}</h1>
  ${desc ? `<p class="promise">${esc(desc)}</p>` : ''}
  <div class="byline">By Atlantic &amp; Vine&nbsp;&nbsp;&middot;&nbsp;&nbsp;${esc(date)}&nbsp;&nbsp;&middot;&nbsp;&nbsp;${mins} min read</div>
  <article>
    ${body}
  </article>
</main>
<section class="cta">
  <h3>Want your brand to read like this everywhere?</h3>
  <p>That is exactly what Client Surge does - your story, told well, in front of the right people.</p>
  <a class="btn" href="/packages">See the packages</a>
</section>
<footer>&copy; ${new Date().getFullYear()} Atlantic And Vine LLC.</footer>
</body>
</html>`;
}
