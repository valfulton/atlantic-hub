/**
 * /newsroom/channel/[slug]
 *
 * Per-client branded channel — "the shareable sales asset" per the sitemap.
 * Mirrors Atlantic_Hub_Playbook/newsroom_client_channel.html exactly:
 *   - Cover hero image with emerald scrim
 *   - Avatar + name + verified badge + tagline + stats + Follow/Share CTAs
 *   - "On the network" strip linking back to /newsroom
 *   - Stories row (brand-specific, derived from article hashtags)
 *   - "Their commercials" section
 *   - "Market briefs on their campaigns" section
 *
 * Two doors via the same logic as /newsroom — `?from=app` or session cookie
 * flips to `data-skin="royale"`.
 */
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getChannelBySlug, listChannelArticles } from '@/lib/newsroom/channel';
import { articleHref, type NewsroomArticle } from '@/lib/newsroom/published';
import { getCopyMap } from '@/lib/copy/store';
import '../../the-wire.css';
import './channel.css';

const CHANNEL_COPY_KEYS = ['newsroom.nav.cta', 'channel.verified', 'channel.network.strip', 'newsroom.footer.copyright'];

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

function PlayIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

/** Dummy placeholder photo for missing heroes — keeps the channel from
 *  looking vacant per val's note. Photos come from picsum (seeded by the
 *  article id, so the same article always gets the same dummy image). */
function placeholderHero(seed: number | string, size = '800/450'): string {
  return `https://picsum.photos/seed/avwire-${seed}/${size}`;
}

function PostCard({ a, kind }: { a: NewsroomArticle; kind: 'commercial' | 'brief' }) {
  const kick =
    kind === 'commercial'
      ? a.heroType === 'video' ? 'Commercial' : 'Feature'
      : KICK_LABEL[a.artifactType] ?? 'PR Segment';
  const bg = a.heroUrl || placeholderHero(a.id, '600/400');
  return (
    <Link href={articleHref(a)} className="wire-post">
      <div className="media" style={{ backgroundImage: `url(${bg})` }}>
        <div className="sc" />
        <span className="kick">{kick}</span>
        {a.publishedAt && <span className="dur"><PlayIcon size={10} /> {formatDate(a.publishedAt)}</span>}
        <span className="pl"><PlayIcon size={14} /></span>
      </div>
      <div className="b">
        <h4>{a.title}</h4>
        {a.excerpt && <p>{a.excerpt}</p>}
        <div className="eng">
          {kind === 'brief' && <span>PR-sourced</span>}
        </div>
      </div>
    </Link>
  );
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const channel = await getChannelBySlug(params.slug).catch(() => null);
  if (!channel) return { title: 'Channel — Atlantic & Vine Wire' };
  return {
    title: `${channel.clientName} — on The Wire`,
    description: channel.tagline || `${channel.clientName} on the Atlantic & Vine Wire — their branded feed on the network.`
  };
}

export default async function ChannelPage({
  params,
  searchParams
}: {
  params: { slug: string };
  searchParams?: { from?: string };
}) {
  const channel = await getChannelBySlug(params.slug);
  if (!channel) notFound();

  // Editable chrome copy (global scope; per-client override can pass the
  // channel's client_id once confirmed). Never throws — defaults on failure.
  const copy = await getCopyMap(CHANNEL_COPY_KEYS, {});

  const articles = await listChannelArticles(channel, 24);

  // Split into "commercials" (video / own-brand) and "briefs" (PR / market / analysis).
  const commercials: NewsroomArticle[] = [];
  const briefs: NewsroomArticle[] = [];
  for (const a of articles) {
    const isCommercial =
      a.heroType === 'video' ||
      a.artifactType === 'own_brand_post';
    (isCommercial ? commercials : briefs).push(a);
  }

  const cookieStore = cookies();
  const hasClientSession = !!cookieStore.get('ah_client_session');
  const fromApp = searchParams?.from === 'app';
  const inApp = hasClientSession || fromApp;

  // Cover / avatar — fall back to picsum seeded by the slug so the page
  // never reads as vacant (per val: "dummy content + photos can stay").
  const cover = channel.coverUrl || placeholderHero(channel.clientSlug, '1600/420');
  const avatar = channel.logoUrl || placeholderHero(`${channel.clientSlug}-avatar`, '256/256');

  const otherDoorHref = inApp
    ? `/newsroom/channel/${channel.clientSlug}`
    : `/newsroom/channel/${channel.clientSlug}?from=app`;
  const otherDoorLabel = inApp ? 'switch to the cream door →' : 'switch to the velvet door →';

  // "Their commercials" + "Market briefs on their campaigns" — names lifted
  // verbatim from the mockup.
  return (
    <div className="wire" data-skin={inApp ? 'royale' : undefined}>
      <div className="wire-doorbar">
        {inApp ? <>Velvet door &nbsp;—&nbsp; <b>this face</b></> : <>Cream door &nbsp;—&nbsp; <b>this face</b></>}
        &nbsp;·&nbsp;
        <Link href={otherDoorHref}>{otherDoorLabel}</Link>
      </div>

      {/* Same nav as /newsroom */}
      <nav className="wire-nav">
        <div className="wire-nav-inner">
          <a className="wire-brand" href="https://atlanticandvine.netlify.app">
            <img className="wire-brand-logo" src="https://atlanticandvine.netlify.app/av-logo.png" alt="Atlantic &amp; Vine" />
            <span className="wire-brand-text">Atlantic &amp; Vine</span>
          </a>
          <ul className="wire-menu">
            <li><a href="https://atlanticandvine.netlify.app/#client-surge">Client Surge</a></li>
            <li><a href="https://atlanticandvine.netlify.app/custom-solutions.html">Custom Solutions</a></li>
            <li><a href="https://atlanticandvine.netlify.app/audit-form.html">Free Audit</a></li>
            <li><Link className="here" href={inApp ? '/newsroom?from=app' : '/newsroom'}>The Wire</Link></li>
            <li className="wire-menu-cta">
              <a className="wire-cta" href="https://atlanticandvine.netlify.app/pop-journey.html">{copy['newsroom.nav.cta']}</a>
            </li>
          </ul>
        </div>
      </nav>

      {/* COVER */}
      <div className="ch-cover" style={{ backgroundImage: `url(${cover})` }}>
        <div className="ch-cover-scrim" />
      </div>

      {/* CHANNEL HEAD */}
      <div className="ch-head">
        <div className="ch-avatar" style={{ backgroundImage: `url(${avatar})` }} />
        <div className="ch-id">
          <div className="ch-vbadge">{copy['channel.verified']}</div>
          <h1>{channel.clientName}</h1>
          {channel.tagline && <div className="ch-tag">{channel.tagline}</div>}
          <div className="ch-stats">
            <span><b>{channel.segmentCount}</b> {channel.segmentCount === 1 ? 'segment' : 'segments'}</span>
            <span><b>{channel.liveCampaignCount}</b> live {channel.liveCampaignCount === 1 ? 'campaign' : 'campaigns'}</span>
            {channel.industry && <span><b>{channel.industry}</b></span>}
          </div>
        </div>
        <div className="ch-cta">
          <button type="button" className="ch-cta-b1">＋ Follow</button>
          <button type="button" className="ch-cta-b2">➦ Share channel</button>
        </div>
      </div>

      {/* Network strip */}
      <div className="ch-net">
        <span className="ch-net-badge">◈ On the network</span>
        <span className="ch-net-copy">{copy['channel.network.strip']}</span>
        <Link href={inApp ? '/newsroom?from=app' : '/newsroom'} className="ch-net-back">
          Back to The Wire →
        </Link>
      </div>

      <div className="wire-wrap">
        {/* Their commercials */}
        {commercials.length > 0 && (
          <section className="wire-sec">
            <div className="wire-sec-head">
              <h3>Their <em>commercials</em></h3>
              <span className="more">See all →</span>
            </div>
            <div className="wire-feed">
              {commercials.slice(0, 6).map((a) => <PostCard key={a.id} a={a} kind="commercial" />)}
            </div>
          </section>
        )}

        {/* Market briefs on their campaigns */}
        {briefs.length > 0 && (
          <section className="wire-sec">
            <div className="wire-sec-head">
              <h3>Market briefs on their <em>campaigns</em></h3>
              <span className="more">See all →</span>
            </div>
            <div className="wire-feed">
              {briefs.slice(0, 6).map((a) => <PostCard key={a.id} a={a} kind="brief" />)}
            </div>
          </section>
        )}

        {/* Empty state — keep the channel from looking vacant */}
        {commercials.length === 0 && briefs.length === 0 && (
          <section className="wire-sec">
            <div className="wire-sec-head">
              <h3>Coming up <em>next</em></h3>
            </div>
            <div className="ch-empty">
              <p>{channel.clientName}&apos;s first segment is being prepared. Check back shortly — or follow the channel to be notified.</p>
            </div>
          </section>
        )}
      </div>

      {/* Footer */}
      <footer className="wire-footer">
        <div className="wire-footer-inner">
          <div className="wire-footer-brand">
            <h3>The Atlantic &amp; <em>Vine</em> Wire</h3>
            <p>{channel.clientName} · a channel on the network. Shareable as their own.</p>
            <span className="tag">Made with intention.</span>
          </div>
          <div className="wire-footer-links">
            <h5>The Network</h5>
            <ul>
              <li><Link href="/newsroom">All stories</Link></li>
              <li><a href="https://atlanticandvine.netlify.app">Atlantic &amp; Vine</a></li>
            </ul>
          </div>
          <div className="wire-footer-links">
            <h5>This Channel</h5>
            <ul>
              <li><a href={`https://atlantic-hub.netlify.app/newsroom/channel/${channel.clientSlug}`}>Share link</a></li>
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
