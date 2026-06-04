/**
 * /newsroom  -- TWO DOORS (#406, val 2026-06-03)
 *
 * Same content, register flips based on entry path:
 *   - Door A (public/marketing) — arrived from the public site or external
 *     link. Cream + emerald + Fraunces (matches the marketing brand).
 *   - Door B (in-app/client) — arrived from inside /client/* (a logged-in
 *     client clicking "Read on the Wire"). Navy + Cormorant + ghost gold
 *     with ClientV3TopNav so the surface reads as the client portal's
 *     own publication.
 *
 * Detection: `ah_client_session` cookie present (logged-in client) OR
 * `?from=app` query param. Default = Door A.
 *
 * "The A&V Wire" framing applies to both — only the chrome flips.
 */
import { cookies } from 'next/headers';
import Link from 'next/link';
import { listPublishedArticles, articleHref, type NewsroomArticle } from '@/lib/newsroom/published';
import ClientV3TopNav from '@/app/client/_components/ClientV3TopNav';
// Skin CSS for the in-app door (scoped under data-skin="social")
import '@/app/client/skin.social.css';
import '@/app/client/client-social.css';

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

function ArticleCard({ a, featured = false, navy = false }: { a: NewsroomArticle; featured?: boolean; navy?: boolean }) {
  // In-app door uses the V3 card classes; public door keeps Tailwind chrome.
  if (navy) {
    return (
      <Link href={articleHref(a)} className="v3-card" style={{ display: 'block', textDecoration: 'none', margin: 0 }}>
        {a.heroUrl && (
          <div style={{
            marginBottom: 14,
            borderRadius: 8,
            overflow: 'hidden',
            aspectRatio: featured ? '2/1' : '16/9',
            background: 'var(--navy-elev)'
          }}>
            {a.heroType === 'video' ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video src={a.heroUrl} muted loop playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.heroUrl} alt={a.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            )}
          </div>
        )}
        <div className="v3-eyebrow" style={{ margin: '0 0 8px' }}>
          {TYPE_LABEL[a.artifactType] ?? 'Insight'}
          {a.publishedAt && <span style={{ marginLeft: 12, color: 'var(--cream-muted)' }}>· {formatDate(a.publishedAt)}</span>}
        </div>
        <h2 className="v3-card__h" style={{ fontSize: featured ? 28 : 20, margin: '0 0 6px' }}>
          {a.title}
        </h2>
        {a.excerpt && (
          <p className="v3-card__p" style={{ marginBottom: a.company ? 10 : 0 }}>{a.excerpt}</p>
        )}
        {a.company && (
          <p style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--cream-muted)', marginTop: 8 }}>
            On <span style={{ color: 'var(--cream)' }}>{a.company}</span>
          </p>
        )}
      </Link>
    );
  }

  // Door A — public cream chrome (existing behavior).
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

export default async function NewsroomIndexPage({
  searchParams
}: {
  searchParams?: { from?: string };
}) {
  // Door detection (server-side). In-app door if either the client session
  // cookie is present OR the URL carries ?from=app (deep-link from inside).
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

  const [featured, ...rest] = articles;

  // Door B — in-app navy register, wrapped in the client V3 chrome.
  if (inApp) {
    return (
      <div data-skin="social">
        <main className="v3-wrap" style={{ maxWidth: 980 }}>
          <ClientV3TopNav />
          <section className="v3-greet">
            <p className="v3-eyebrow">Newsroom</p>
            <h1 className="v3-h1">Newsroom.</h1>
          </section>

          {failed ? (
            <article className="v3-card">
              <p className="v3-card__p">The Wire is taking a moment to load. Please refresh shortly.</p>
            </article>
          ) : articles.length === 0 ? (
            <article className="v3-card">
              <h3 className="v3-card__h">The Wire is warming up.</h3>
              <p className="v3-card__p">Your first published piece will land here as soon as it goes out.</p>
            </article>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '14px' }}>
              {featured && <ArticleCard a={featured} featured navy />}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
                {rest.map((a) => (
                  <ArticleCard a={a} key={a.slug} navy />
                ))}
              </div>
            </div>
          )}

          <p className="v3-foot">QUIET · LEGIBLE · VERIFIABLE</p>
        </main>
      </div>
    );
  }

  // Door A — public/marketing register (cream + emerald + Fraunces).
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
