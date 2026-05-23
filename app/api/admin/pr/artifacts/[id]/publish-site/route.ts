/**
 * POST /api/admin/pr/artifacts/[id]/publish-site
 *
 * Publish an APPROVED content artifact onto a brand/client static site by
 * committing a rendered post into the site's GitHub repo (Netlify then rebuilds).
 * Mirrors the newsroom publish but the destination is an external site.
 *
 * Body: { destinationId: string }  // e.g. 'av_site'
 *
 * Gate: the artifact must be status 'approved' (operator approval stands; see
 * [[approval-branding-gate]]). On success the artifact is marked 'published' and
 * its live URL is stored in meta_json.site_url.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import { getDestination } from '@/lib/publishing/destinations';
import { renderPostHtml, renderBlogIndexHtml, type BlogManifestPost } from '@/lib/publishing/render_post';
import { publishFileToRepo, getFileFromRepo, GitHubTokenMissingError, GitHubPublishError } from '@/lib/publishing/github_site';
import { articleSlug } from '@/lib/newsroom/published';
import { CONTENT_EVENTS } from '@/lib/pr/types';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ArtifactRow extends RowDataPacket {
  id: number;
  title: string | null;
  body_text: string | null;
  meta_json: unknown;
  status: string;
  artifact_type: string;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/artifacts/[id]/publish-site:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* optional */
  }
  const destinationId = typeof body.destinationId === 'string' ? body.destinationId : '';
  const dest = getDestination(destinationId);
  if (!dest || !dest.repo) {
    return NextResponse.json({ error: 'unknown or non-repo destination' }, { status: 400 });
  }

  try {
    const db = getAvDb();
    const [rows] = await db.execute<ArtifactRow[]>(
      `SELECT id, title, body_text, meta_json, status, artifact_type FROM content_artifacts WHERE id = ? LIMIT 1`,
      [id]
    );
    const art = rows[0];
    if (!art) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (art.status !== 'approved') {
      return NextResponse.json({ error: 'artifact must be approved before publishing to a site' }, { status: 409 });
    }

    let meta: Record<string, unknown> = {};
    if (art.meta_json != null) {
      try { meta = (typeof art.meta_json === 'string' ? JSON.parse(art.meta_json) : art.meta_json) as Record<string, unknown>; } catch { meta = {}; }
    }

    const title = (art.title && art.title.trim()) || 'Untitled';
    const slug = articleSlug(title, art.id);

    // Hero media: pasted URL, or an absolute hub URL for a commercial-asset hero
    // (the external site is cross-origin, so the <img>/<video> points back here).
    const HUB_BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://atlantic-hub.netlify.app';
    const heroType = meta.hero_type === 'image' || meta.hero_type === 'video' ? (meta.hero_type as 'image' | 'video') : null;
    let heroUrl: string | null = null;
    if (typeof meta.hero_url === 'string' && meta.hero_url) heroUrl = meta.hero_url as string;
    else if (typeof meta.hero_asset_id === 'number') heroUrl = `${HUB_BASE}/api/public/hero/${meta.hero_asset_id}`;

    const html = renderPostHtml({
      title,
      bodyText: art.body_text || '',
      category: typeof meta.category === 'string' ? meta.category : 'Journal',
      metaDescription: typeof meta.meta_description === 'string' ? meta.meta_description : null,
      heroUrl,
      heroType
    });

    const path = `${dest.repo.pathPrefix}/${slug}.html`;
    const committed = await publishFileToRepo({
      owner: dest.repo.owner,
      repo: dest.repo.repo,
      branch: dest.repo.branch,
      path,
      content: html,
      message: `Publish post: ${title}`
    });

    const liveUrl = `${dest.repo.publicBaseUrl}/${slug}`;
    meta.site_url = liveUrl;
    meta.published_destination = dest.id;

    // The hub OWNS the blog index: maintain a manifest (blog/posts.json) and
    // regenerate blog/index.html from it so new posts auto-list. Best-effort --
    // the post page is already committed, so we never fail the publish here.
    let indexed = false;
    let indexNote: string | undefined;
    if (dest.repo.indexPath) {
      try {
        const manifestPath = `${dest.repo.pathPrefix}/posts.json`;
        const mf = await getFileFromRepo({ owner: dest.repo.owner, repo: dest.repo.repo, path: manifestPath, branch: dest.repo.branch });
        let posts: BlogManifestPost[] = [];
        if (mf.content) {
          try { const parsed = JSON.parse(mf.content); if (Array.isArray(parsed)) posts = parsed as BlogManifestPost[]; } catch { posts = []; }
        }
        const words = (art.body_text || '').split(/\s+/).filter(Boolean).length;
        const entry: BlogManifestPost = {
          slug,
          title,
          href: `/${dest.repo.pathPrefix}/${slug}`,
          excerpt: typeof meta.meta_description === 'string' ? meta.meta_description : null,
          category: typeof meta.category === 'string' ? meta.category : 'Journal',
          readMinutes: Math.max(2, Math.round(words / 200)),
          date: new Date().toISOString(),
          heroUrl,
          heroType
        };
        // newest first; replace any prior entry for the same slug
        posts = [entry, ...posts.filter((p) => p.slug !== slug)];

        await publishFileToRepo({
          owner: dest.repo.owner, repo: dest.repo.repo, branch: dest.repo.branch,
          path: manifestPath, content: JSON.stringify(posts, null, 2),
          message: `Update blog manifest: ${title}`
        });
        await publishFileToRepo({
          owner: dest.repo.owner, repo: dest.repo.repo, branch: dest.repo.branch,
          path: dest.repo.indexPath, content: renderBlogIndexHtml(posts),
          message: `Regenerate blog index: ${title}`
        });
        indexed = true;
      } catch (e) {
        indexNote = `Post published; blog index auto-update skipped: ${(e as Error).message}`;
      }
    }

    await db.execute<ResultSetHeader>(
      `UPDATE content_artifacts SET status = 'published', meta_json = CAST(? AS JSON), updated_at = NOW() WHERE id = ?`,
      [JSON.stringify(meta), id]
    );

    await logEvent({
      eventType: CONTENT_EVENTS.artifactPublished,
      userId: guard.actor.userId,
      source: 'pr_desk',
      status: 'success',
      payload: { artifact_id: id, destination: dest.id, repo: `${dest.repo.owner}/${dest.repo.repo}`, path, commit: committed.commitSha, live_url: liveUrl }
    });

    return NextResponse.json({ ok: true, url: liveUrl, path, commitSha: committed.commitSha, indexed, indexNote });
  } catch (err) {
    if (err instanceof GitHubTokenMissingError) {
      return NextResponse.json({ error: 'GITHUB_PUBLISH_TOKEN is not set in the environment. Add it in Netlify, then retry.' }, { status: 503 });
    }
    if (err instanceof GitHubPublishError) {
      return NextResponse.json({ error: `Site publish failed: ${err.message}` }, { status: 502 });
    }
    console.error('[pr:artifact:publish-site]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
