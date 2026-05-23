/**
 * /newsroom/[slug]  -- a single published article.
 *
 * Server component. Looks the artifact up by the trailing `-<id>` in the slug,
 * 404s cleanly if it is not a published public artifact. Renders the body with a
 * light, dependency-free Markdown-ish formatter (headings / lists / paragraphs)
 * so AI-drafted posts read like a real article without pulling in a parser.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getPublishedArticle } from '@/lib/newsroom/published';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TYPE_LABEL: Record<string, string> = {
  blog_article: 'Insight',
  seo_article: 'Guide',
  own_brand_post: 'Note'
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export async function generateMetadata({
  params
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const article = await getPublishedArticle(params.slug).catch(() => null);
  if (!article) return { title: 'Article - Atlantic & Vine Newsroom' };
  const description = article.metaDescription || article.excerpt || undefined;
  return {
    title: `${article.title} - Atlantic & Vine`,
    description,
    openGraph: { title: article.title, description, type: 'article' }
  };
}

/** Strip inline emphasis markers for clean rendering (no parser dependency). */
function clean(line: string): string {
  return line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1$2').replace(/`/g, '');
}

interface Block {
  kind: 'h2' | 'h3' | 'p' | 'ul';
  text?: string;
  items?: string[];
}

function toBlocks(body: string): Block[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: 'p', text: clean(para.join(' ')) });
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push({ kind: 'ul', items: list.map(clean) });
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    if (/^#{3,6}\s/.test(line)) {
      flushPara();
      flushList();
      blocks.push({ kind: 'h3', text: clean(line.replace(/^#{3,6}\s+/, '')) });
    } else if (/^#{1,2}\s/.test(line)) {
      flushPara();
      flushList();
      blocks.push({ kind: 'h2', text: clean(line.replace(/^#{1,2}\s+/, '')) });
    } else if (/^[-*]\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^[-*]\s+/, ''));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

export default async function NewsroomArticlePage({ params }: { params: { slug: string } }) {
  let article = null;
  try {
    article = await getPublishedArticle(params.slug);
  } catch {
    article = null;
  }
  if (!article) notFound();

  const blocks = toBlocks(article.bodyText);

  return (
    <main className="max-w-2xl mx-auto px-4 py-12 sm:py-16">
      <Link href="/newsroom" className="text-sm text-muted hover:text-ink transition-colors no-underline">
        &lt;- Newsroom
      </Link>

      <article className="mt-6">
        <div className="flex items-center gap-3 mb-4 text-[10px] uppercase tracking-[0.16em]">
          <span className="text-brand">{TYPE_LABEL[article.artifactType] ?? 'Insight'}</span>
          {article.publishedAt && <span className="text-muted">{formatDate(article.publishedAt)}</span>}
        </div>

        <h1 className="text-3xl sm:text-4xl font-semibold text-ink tracking-tight leading-tight">
          {article.title}
        </h1>

        {article.company && (
          <p className="mt-3 text-sm text-muted">
            On <span className="text-ink">{article.company}</span>
          </p>
        )}

        <div className="mt-8 space-y-5">
          {blocks.map((b, i) => {
            if (b.kind === 'h2')
              return (
                <h2 key={i} className="text-xl sm:text-2xl font-semibold text-ink pt-2">
                  {b.text}
                </h2>
              );
            if (b.kind === 'h3')
              return (
                <h3 key={i} className="text-lg font-semibold text-ink pt-1">
                  {b.text}
                </h3>
              );
            if (b.kind === 'ul')
              return (
                <ul key={i} className="list-disc pl-5 space-y-1.5 text-ink/90">
                  {b.items?.map((it, j) => (
                    <li key={j} className="leading-relaxed">
                      {it}
                    </li>
                  ))}
                </ul>
              );
            return (
              <p key={i} className="text-ink/90 leading-relaxed text-[15px] sm:text-base">
                {b.text}
              </p>
            );
          })}
        </div>

        {article.hashtags.length > 0 && (
          <div className="mt-10 pt-6 border-t border-border flex flex-wrap gap-2">
            {article.hashtags.map((h) => (
              <span key={h} className="text-xs text-muted">
                #{h.replace(/^#/, '')}
              </span>
            ))}
          </div>
        )}
      </article>

      <div className="mt-12 rounded-2xl border border-border bg-surface p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="text-sm text-muted">Want results like this for your business?</div>
        <a
          href="https://atlanticandvine.netlify.app/#client-intake"
          target="_blank"
          rel="noopener"
          className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-brand text-brand-fg text-sm font-medium hover:opacity-90 no-underline"
        >
          Work with us
        </a>
      </div>
    </main>
  );
}
