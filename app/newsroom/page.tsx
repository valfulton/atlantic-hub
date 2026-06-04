/**
 * /newsroom — The Wire (val 2026-06-04, revised)
 *
 * Mirrors the two designer mockups in Atlantic_Hub_Playbook/:
 *   Door A — newsroom_social_desktop.html  (cream + emerald, public/marketing)
 *   Door B — newsroom_velvet_royale.html  (obsidian + aurum, in-app/invitation)
 *
 * Both doors share the SAME body and the SAME stylesheet (the-wire.css).
 * The skin flips via data-skin="royale" on the outer .wire div — that's the
 * only thing that changes. Retune either face in the-wire.css; never bake
 * hex literals into this file.
 *
 * Detection: ah_client_session cookie present OR ?from=app query param.
 */
import Link from 'next/link';
import { listPublishedArticles, articleHref, type NewsroomArticle } from '@/lib/newsroom/published';
import { listChannels } from '@/lib/newsroom/channel';
import { getCopyMap } from '@/lib/copy/store';
import './the-wire.css';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Editable chrome copy for the newsroom (article title/excerpt stay DB-driven). */
const NEWSROOM_COPY_KEYS = [
  'newsroom.wire.sub', 'newsroom.live.badge', 'newsroom.nav.cta', 'newsroom.hero.kicker',
  'newsroom.footer.tagline', 'newsroom.footer.signoff', 'newsroom.footer.copyright',
];
type Copy = Record<string, string>;

/** Map our artifact_type taxonomy to the designer's kick-label vocabulary. */
const KICK_LABEL: Record<string, string> = {
  blog_article: 'Market Brief',
  seo_article: 'Analysis',
  own_brand_post: 'Feature',
  press_release: 'PR Segment'
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** A brand chip on the Stories row — has a real slug so clicking opens
 *  /newsroom/channel/[slug]. */
type StoryBrand = { name: string; slug: string };

function PlayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PostCard({ a }: { a: NewsroomArticle }) {
  const kick = KICK_LABEL[a.artifactType] ?? 'Insight';
  const isVideo = a.heroType === 'video';
  return (
    <Link href={articleHref(a)} className="wire-post">
      <div
        className="media"
        style={{ backgroundImage: a.heroUrl ? `url(${a.heroUrl})` : undefined }}
      >
        <div className="sc" />
        <span className="kick">{kick}</span>
        {isVideo && (
          <span className="pl">
            <PlayIcon size={14} />
          </span>
        )}
        {a.publishedAt && (
          <span className="dur">
            <PlayIcon size={10} /> {formatDate(a.publishedAt)}
          </span>
        )}
      </div>
      <div className="b">
        <h4>{a.title}</h4>
        {a.excerpt && <p>{a.excerpt}</p>}
        <div className="eng">
          {a.company && <span className="desk">{a.company}</span>}
        </div>
      </div>
    </Link>
  );
}

function StoriesRow({ brands, inApp }: { brands: StoryBrand[]; inApp: boolean }) {
  if (brands.length === 0) return null;
  // Initials inside the gradient ring — placeholder until real brand avatars.
  function initials(name: string): string {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '·';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (
    <div className="wire-stories" aria-label="Brands on the network">
      {brands.map((b) => (
        <Link
          key={b.slug}
          href={`/newsroom/channel/${b.slug}${inApp ? '?from=app' : ''}`}
          className="wire-story"
          title={b.name}
        >
          <div className="ring">
            <div className="pic">{initials(b.name)}</div>
          </div>
          <span className="lbl">{b.name}</span>
        </Link>
      ))}
    </div>
  );
}

function WireBody({
  articles,
  brands,
  failed,
  inApp,
  copy
}: {
  articles: NewsroomArticle[];
  brands: StoryBrand[];
  failed: boolean;
  inApp: boolean;
  copy: Copy;
}) {
  const [featured, ...rest] = articles;
  const trending = rest.slice(0, 6);
  const briefs = rest.slice(6, 12);

  return (
    <div className={'wire'} data-skin={inApp ? 'royale' : undefined}>
      {/* Door bar only appears in the velvet demo (?door=velvet). The public
          cream newsroom has no dev chrome — it just matches the marketing site. */}
      {inApp && (
        <div className="wire-doorbar">
          Velvet door &nbsp;—&nbsp; <b>this face</b> &nbsp;·&nbsp;
          <Link href="/newsroom">switch to the cream door →</Link>
        </div>
      )}

      {/* Nav */}
      <nav className="wire-nav">
        <div className="wire-nav-inner">
          <a className="wire-brand" href="https://atlanticandvine.netlify.app">
            <img
              className="wire-brand-logo"
              src="https://atlanticandvine.netlify.app/av-logo.png"
              alt="Atlantic &amp; Vine"
            />
            <span className="wire-brand-text">Atlantic &amp; Vine</span>
          </a>
          <ul className="wire-menu">
            <li><a href="https://atlanticandvine.netlify.app/#client-surge">Client Surge</a></li>
            <li><a href="https://atlanticandvine.netlify.app/custom-solutions.html">Custom Solutions</a></li>
            <li><a href="https://atlanticandvine.netlify.app/audit-form.html">Free Audit</a></li>
            <li><Link className="here" href="/newsroom">The Wire</Link></li>
            <li className="wire-menu-cta">
              <a className="wire-cta" href="https://atlanticandvine.netlify.app/pop-journey.html">
                {copy['newsroom.nav.cta']}
              </a>
            </li>
          </ul>
        </div>
      </nav>

      <div className="wire-wrap">
        {/* Wire head */}
        <div className="wire-head">
          <h1>The <em>Wire</em></h1>
          <span className="sub">{copy['newsroom.wire.sub']}</span>
          <span className="live"><span className="d" /> {copy['newsroom.live.badge']}</span>
        </div>

        {/* Stories row — chips link to /newsroom/channel/[slug] */}
        <StoriesRow brands={brands} inApp={inApp} />

        {failed && (
          <div className="wire-post" style={{ padding: '1.5rem' }}>
            <p style={{ margin: 0 }}>The Wire is taking a moment to load. Please refresh shortly.</p>
          </div>
        )}

        {!failed && articles.length === 0 && (
          <div className="wire-post" style={{ padding: '1.5rem' }}>
            <h4 style={{ fontFamily: 'Fraunces, serif', margin: '0 0 0.5rem' }}>Fresh stories are on the way.</h4>
            <p style={{ margin: 0 }}>New pieces will appear here as they publish.</p>
          </div>
        )}

        {/* Hero — the featured (most-recent) article */}
        {featured && (
          <Link href={articleHref(featured)} className="wire-hero">
            <div
              className="ph"
              style={{ backgroundImage: featured.heroUrl ? `url(${featured.heroUrl})` : undefined }}
            />
            <div className="scrim" />
            <div className="play"><PlayIcon size={30} /></div>
            <div className="body">
              <span className="pill">
                <PlayIcon size={10} /> {copy['newsroom.hero.kicker']} · {KICK_LABEL[featured.artifactType] ?? 'Insight'}
              </span>
              <h2>{featured.title}</h2>
              {featured.excerpt && <p>{featured.excerpt}</p>}
              <div className="eng">
                {featured.publishedAt && <span className="wire-ic">{formatDate(featured.publishedAt)}</span>}
                {featured.company && <span className="desk">{featured.company}</span>}
              </div>
            </div>
          </Link>
        )}

        {/* Trending now */}
        {trending.length > 0 && (
          <section className="wire-sec">
            <div className="wire-sec-head">
              <span className="ico">🔥</span>
              <h3>Trending <em>now</em></h3>
              <span className="more">See all →</span>
            </div>
            <div className="wire-feed">
              {trending.map((a) => <PostCard key={a.id} a={a} />)}
            </div>
          </section>
        )}

        {/* Market Briefs */}
        {briefs.length > 0 && (
          <section className="wire-sec">
            <div className="wire-sec-head">
              <span className="ico">📈</span>
              <h3>Market <em>Briefs</em></h3>
              <span className="more">See all →</span>
            </div>
            <div className="wire-feed">
              {briefs.map((a) => <PostCard key={a.id} a={a} />)}
            </div>
          </section>
        )}
      </div>

      {/* Footer */}
      <footer className="wire-footer">
        <div className="wire-footer-inner">
          <div className="wire-footer-brand">
            <h3>Atlantic &amp; Vine</h3>
            <p>{copy['newsroom.footer.tagline']}</p>
            <span className="tag">{copy['newsroom.footer.signoff']}</span>
          </div>
          <div className="wire-footer-links">
            <h5>Services</h5>
            <ul>
              <li><a href="https://atlanticandvine.netlify.app/#client-surge">Client Surge</a></li>
              <li><a href="https://atlanticandvine.netlify.app/custom-solutions.html">Custom Solutions</a></li>
              <li><a href="https://atlanticandvine.netlify.app/audit-form.html">Free Audit</a></li>
              <li><a href="https://atlanticandvine.netlify.app/pop-journey.html">Apply Now</a></li>
            </ul>
          </div>
          <div className="wire-footer-links">
            <h5>Partners</h5>
            <ul>
              <li><a href="https://eventsbywater.com">Events by Water</a></li>
              <li><a href="https://1ecs.com">1ecs Private Chefs</a></li>
            </ul>
          </div>
          <div className="wire-footer-links">
            <h5>Connect</h5>
            <ul>
              <li><a href="mailto:info@atlanticandvine.com">info@atlanticandvine.com</a></li>
              <li><Link href="/client/login">Client Login</Link></li>
            </ul>
          </div>
        </div>
        <div className="wire-footer-bottom">
          <span>{copy['newsroom.footer.copyright']}</span>
          <span>Made with intention.</span>
        </div>
      </footer>
    </div>
  );
}

export default async function NewsroomIndexPage({
  searchParams
}: {
  searchParams?: { from?: string; door?: string };
}) {
  // The PUBLIC newsroom must always match the marketing site (cream + emerald),
  // for everyone — including logged-in operators/clients. The velvet "after
  // dark" skin is opt-in ONLY via ?door=velvet (kept for the design demo); it
  // is never auto-triggered by a session. (val 2026-06-04.)
  const inApp = searchParams?.door === 'velvet';

  // Editable chrome copy. Global scope for now; per-client newsroom override
  // (D3 acceptance for an in-app client_id) needs the ah_client_session →
  // client_id resolver — wire `clientId` here once the conductor confirms the
  // session helper. getCopyMap never throws; defaults render on any failure.
  const copy = await getCopyMap(NEWSROOM_COPY_KEYS, {});

  let articles: NewsroomArticle[] = [];
  let channels: { clientName: string; clientSlug: string; segmentCount: number }[] = [];
  let failed = false;
  try {
    // Two queries run in parallel — articles for the body, channels for the
    // Stories row (each chip links to /newsroom/channel/[slug]).
    [articles, channels] = await Promise.all([
      listPublishedArticles({ limit: 50 }),
      listChannels().catch(() => [])
    ]);
  } catch {
    failed = true;
  }

  // Dedupe + cap brand chips. Real channels first; fall back to companies
  // from articles when no client row exists yet (legacy data).
  const seen = new Set<string>();
  const brands: StoryBrand[] = [];
  for (const c of channels) {
    if (!c.clientSlug || seen.has(c.clientSlug)) continue;
    seen.add(c.clientSlug);
    brands.push({ name: c.clientName, slug: c.clientSlug });
    if (brands.length >= 7) break;
  }

  return <WireBody articles={articles} brands={brands} failed={failed} inApp={inApp} copy={copy} />;
}
