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
