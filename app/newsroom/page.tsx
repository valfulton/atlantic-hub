/**
 * /newsroom  -- public index of published content artifacts.
 *
 * Server component, rendered fresh each request (force-dynamic) so a freshly
 * published post shows up immediately. Reads straight from the DB via
 * lib/newsroom/published.ts; no API hop, no auth.
 */
import Link from 'next/link';
import { listPublishedArticles, articleHref, type NewsroomArticle } from '@/lib/newsroom/published';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TYPE_LABEL: Record<string, string> = {
  blog_article: 'Insight',
  seo_article: 'Guide',
  own_brand_post: 'Note',
  press_release: 'Press release'
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function ArticleCard({ a, featured = false }: { a: NewsroomArticle; featured?: boolean }) {
  return (
    <Link
      href={articleHref(a)}
      className={`group block no-underline rounded-2xl border border-border bg-surface hover:bg-surface-2 transition-colors overflow-hidden ${
        featured ? '' : ''
      }`}
    >
      {a.heroUrl && (
        <div className={`w-full overflow-hidden ${featured ? 'aspect-[2/1]' : 'aspect-video'}`} style={{ background: '#000' }}>
          {a.heroType === 'video' ? (
            <video src={a.heroUrl} muted loop playsInline preload="metadata" className="w-full h-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.heroUrl} alt={a.title} className="w-full h-full object-cover" />
          )}
        </div>
      )}
      <div className={featured ? 'p-7 sm:p-9' : 'p-6'}>
      <div className="flex items-center gap-3 mb-3 text-[10px] uppercase tracking-[0.16em]">
        <span className="text-brand">{TYPE_LABEL[a.artifactType] ?? 'Insight'}</span>
        {a.publishedAt && <span className="text-muted">{formatDate(a.publishedAt)}</span>}
      </div>
      <h2
        className={`text-ink font-semibold leading-snug group-hover:text-brand transition-colors ${
          featured ? 'text-2xl sm:text-3xl' : 'text-lg'
        }`}
      >
        {a.title}
      </h2>
      {a.excerpt && (
        <p className={`text-muted mt-3 leading-relaxed ${featured ? 'text-base' : 'text-sm'}`}>
          {a.excerpt}
        </p>
      )}
      {a.company && (
        <p className="mt-4 text-xs text-muted">
          On <span className="text-ink">{a.company}</span>
        </p>
      )}
      </div>
    </Link>
  );
}

export default async function NewsroomIndexPage() {
  let articles: NewsroomArticle[] = [];
  let failed = false;
  try {
    articles = await listPublishedArticles({ limit: 50 });
  } catch {
    failed = true;
  }

  const [featured, ...rest] = articles;

  return (
    <main className="max-w-5xl mx-auto px-4 py-12 sm:py-16">
      <section className="mb-12 sm:mb-16">
        <h1 className="text-3xl sm:text-5xl font-semibold text-ink tracking-tight">Newsroom</h1>
        <p className="text-muted mt-5 max-w-2xl text-base sm:text-lg leading-relaxed">
          Insights, announcements, and field notes on AI-native marketing - written from the
          intelligence we accumulate working with real businesses.
        </p>
      </section>

      {failed ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-muted">
          The newsroom is taking a moment to load. Please refresh shortly.
        </div>
      ) : articles.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8">
          <h2 className="text-ink font-medium text-lg">Fresh stories are on the way.</h2>
          <p className="text-muted mt-2 text-sm leading-relaxed">
            Our first published pieces will appear here shortly. Check back soon.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {featured && <ArticleCard a={featured} featured />}
          {rest.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-6">
              {rest.map((a) => (
                <ArticleCard key={a.id} a={a} />
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
