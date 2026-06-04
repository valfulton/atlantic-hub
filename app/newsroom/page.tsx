/**
 * /newsroom -- TWO DOORS (val 2026-06-03, revised)
 *
 * Same body. Surface flips based on entry path — matches the two GATES:
 *   - Door A (PUBLIC / MARKETING) — default. Cream + emerald + Fraunces,
 *     same register as /inquire.html and the marketing site. Applied via
 *     `data-surface="client"` (the brand-tokens.css client-portal override).
 *   - Door B (IN-APP / INVITATION) — when the visitor is signed in OR the
 *     URL carries `?from=app`. Velvet Royale: obsidian + aurum + platinum.
 *     Applied via `data-skin="royale"`.
 *
 * Detection: `ah_client_session` cookie present OR `?from=app` query param.
 *
 * IMPORTANT: this file does NOT bake hex literals. All color comes from
 * brand-tokens.css. To retune either door, edit those tokens — not here.
 */
import { cookies } from 'next/headers';
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
      className="group block no-underline rounded-2xl border border-border bg-surface hover:bg-surface-2 transition-colors overflow-hidden"
    >
      {a.heroUrl && (
        <div
          className={`w-full overflow-hidden ${featured ? 'aspect-[2/1]' : 'aspect-video'}`}
          style={{ background: 'var(--surface-3)' }}
        >
          {a.heroType === 'video' ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={a.heroUrl}
              muted
              loop
              playsInline
              preload="metadata"
              className="w-full h-full object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.heroUrl} alt={a.title} className="w-full h-full object-cover" />
          )}
        </div>
      )}
      <div className={featured ? 'p-7 sm:p-9' : 'p-6'}>
        <div className="flex items-center gap-3 mb-3 text-[10px] uppercase tracking-[0.18em]">
          <span className="text-brand font-medium">{TYPE_LABEL[a.artifactType] ?? 'Insight'}</span>
          {a.publishedAt && <span className="text-muted">{formatDate(a.publishedAt)}</span>}
        </div>
        <h2
          className={`text-ink font-semibold leading-snug group-hover:text-brand transition-colors ${
            featured ? 'text-2xl sm:text-3xl' : 'text-lg'
          }`}
          style={{ fontFamily: 'var(--font-serif)' }}
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

function NewsroomBody({ articles, failed }: { articles: NewsroomArticle[]; failed: boolean }) {
  const [featured, ...rest] = articles;
  return (
    <main className="max-w-5xl mx-auto px-4 py-12 sm:py-16" style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <section className="mb-12 sm:mb-16">
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted mb-3">Newsroom</p>
        <h1
          className="text-3xl sm:text-5xl font-semibold text-ink tracking-tight"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Newsroom
        </h1>
      </section>

      {failed ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-muted">
          The newsroom is taking a moment to load. Please refresh shortly.
        </div>
      ) : articles.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8">
          <h2 className="text-ink font-medium text-lg" style={{ fontFamily: 'var(--font-serif)' }}>
            Fresh stories are on the way.
          </h2>
          <p className="text-muted mt-2 text-sm leading-relaxed">
            New pieces will appear here as they publish.
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

export default async function NewsroomIndexPage({
  searchParams
}: {
  searchParams?: { from?: string };
}) {
  const cookieStore = cookies();
  const hasClientSession = !!cookieStore.get('ah_client_session');
  const fromApp = searchParams?.from === 'app';
  const inApp = hasClientSession || fromApp;

  let articles: NewsroomArticle[] = [];
  let failed = false;
  try {
    articles = await listPublishedArticles({ limit: 50 });
  } catch {
    failed = true;
  }

  // Door B — IN-APP / INVITATION. Velvet Royale (obsidian + aurum).
  if (inApp) {
    return (
      <div data-skin="royale">
        <NewsroomBody articles={articles} failed={failed} />
      </div>
    );
  }

  // Door A — PUBLIC / MARKETING. Cream + emerald + Fraunces.
  return (
    <div data-surface="client">
      <NewsroomBody articles={articles} failed={failed} />
    </div>
  );
}
