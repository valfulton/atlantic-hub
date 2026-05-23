/**
 * lib/newsroom/published.ts
 *
 * Read-only access to the PUBLIC newsroom: the published content_artifacts that
 * make Atlantic & Vine look like a live operating business. This is the public
 * face of the luxury client hub -- the moment an operator hits "Mark published"
 * on a drafted blog post in the PR desk, it appears here on a real, indexable
 * page.
 *
 * Lifecycle (SYSTEM_CONSTITUTION section 3): draft -> approved -> published.
 * The newsroom shows ONLY status='published'. Drafts and approved-but-unpublished
 * work never leak to the public surface.
 *
 * Privacy: client_deliverable artifacts are private work product for a specific
 * client and are NEVER surfaced here. We publish thought-leadership / own-brand
 * content (blog_article, seo_article, own_brand_post).
 *
 * No auth: callers are public server components under /newsroom (not in the
 * middleware matcher). We therefore expose only public-safe fields and never the
 * raw lead/email/internal ids beyond what a reader needs.
 */
import { getAvDb } from '@/lib/db/av';
import { DEFAULT_TENANT } from '@/lib/pr/types';
import type { RowDataPacket } from 'mysql2';

/** Artifact types that are safe to show publicly. */
const PUBLIC_ARTIFACT_TYPES = ['blog_article', 'seo_article', 'own_brand_post'] as const;

export interface NewsroomArticle {
  id: number;
  tenantId: string;
  artifactType: string;
  title: string;
  /** URL slug, always ending in `-<id>` so lookups are unique + pretty. */
  slug: string;
  bodyText: string;
  /** Short plain-text lead-in for cards + meta description. */
  excerpt: string;
  /** Optional SEO meta description from the drafter. */
  metaDescription: string | null;
  /** Company the piece is about / attributed to, when matched to a lead. */
  company: string | null;
  publishedAt: string | null;
  hashtags: string[];
  /** Hero media (top of post + card image), if attached. */
  heroUrl: string | null;
  heroType: 'image' | 'video' | null;
}

interface ArticleRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  artifact_type: string;
  title: string | null;
  body_text: string | null;
  meta_json: unknown;
  status: string;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  company: string | null;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 72)
    .replace(/^-|-$/g, '');
}

/** Build a unique, pretty slug: `<title-slug>-<id>`. */
export function articleSlug(title: string | null, id: number): string {
  const base = slugify(title || 'post');
  return base ? `${base}-${id}` : `post-${id}`;
}

/** Public URL for an article. */
export function articleHref(article: { title: string | null; id: number }): string {
  return `/newsroom/${articleSlug(article.title, article.id)}`;
}

/** Pull a trailing `-<id>` off a slug param. Falls back to a bare numeric id. */
export function idFromSlug(slug: string): number | null {
  const m = slug.match(/(?:^|-)(\d+)$/);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const bare = Number.parseInt(slug, 10);
  return Number.isFinite(bare) && bare > 0 ? bare : null;
}

function parseMeta(raw: unknown): {
  metaDescription: string | null;
  hashtags: string[];
  heroUrl: string | null;
  heroType: 'image' | 'video' | null;
} {
  let meta: Record<string, unknown> | null = null;
  if (raw != null) {
    try {
      meta = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
    } catch {
      meta = null;
    }
  }
  const metaDescription =
    meta && typeof meta.meta_description === 'string' ? (meta.meta_description as string) : null;
  const hashtags =
    meta && Array.isArray(meta.hashtags)
      ? (meta.hashtags as unknown[]).filter((h): h is string => typeof h === 'string').slice(0, 12)
      : [];
  const heroType =
    meta && (meta.hero_type === 'image' || meta.hero_type === 'video') ? (meta.hero_type as 'image' | 'video') : null;
  let heroUrl: string | null = null;
  if (meta && typeof meta.hero_url === 'string' && meta.hero_url) {
    heroUrl = meta.hero_url as string;
  } else if (meta && typeof meta.hero_asset_id === 'number') {
    heroUrl = `/api/public/hero/${meta.hero_asset_id}`;
  }
  return { metaDescription, hashtags, heroUrl, heroType: heroUrl ? heroType : null };
}

function makeExcerpt(body: string | null, max = 200): string {
  if (!body) return '';
  const flat = body
    .replace(/\r\n/g, '\n')
    .split('\n')
    // drop markdown headings / bullets for a clean lead-in
    .filter((l) => l.trim() && !/^#{1,6}\s/.test(l.trim()))
    .join(' ')
    .replace(/[#*_>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max).replace(/\s+\S*$/, '') + '...';
}

function toIso(v: Date | string | null): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function rowToArticle(r: ArticleRow): NewsroomArticle {
  const { metaDescription, hashtags, heroUrl, heroType } = parseMeta(r.meta_json);
  const title = (r.title && r.title.trim()) || 'Untitled';
  const body = r.body_text || '';
  return {
    id: r.id,
    tenantId: r.tenant_id,
    artifactType: r.artifact_type,
    title,
    slug: articleSlug(title, r.id),
    bodyText: body,
    excerpt: metaDescription || makeExcerpt(body),
    metaDescription,
    company: r.company,
    publishedAt: toIso(r.updated_at) || toIso(r.created_at),
    hashtags,
    heroUrl,
    heroType
  };
}

/**
 * List published articles for the public newsroom, newest first.
 */
export async function listPublishedArticles(opts?: {
  tenantId?: string;
  limit?: number;
}): Promise<NewsroomArticle[]> {
  const tenantId = opts?.tenantId || DEFAULT_TENANT;
  const limit = Math.max(1, Math.min(100, opts?.limit ?? 50));
  const typePlaceholders = PUBLIC_ARTIFACT_TYPES.map(() => '?').join(', ');

  const db = getAvDb();
  // `limit` is clamped to an int above; inline it (mysql2 + HostGator throws
  // ER_WRONG_ARGUMENTS on a prepared LIMIT ?).
  const [rows] = await db.execute<ArticleRow[]>(
    `SELECT a.id, a.tenant_id, a.artifact_type, a.title, a.body_text, a.meta_json,
            a.status, a.created_at, a.updated_at,
            l.company AS company
       FROM content_artifacts a
       LEFT JOIN leads l ON l.id = a.lead_id
      WHERE a.tenant_id = ?
        AND a.status = 'published'
        AND a.artifact_type IN (${typePlaceholders})
      ORDER BY a.updated_at DESC, a.id DESC
      LIMIT ${limit}`,
    [tenantId, ...PUBLIC_ARTIFACT_TYPES]
  );
  return rows.map(rowToArticle);
}

/**
 * Fetch a single published article by its slug (or bare id). Returns null if it
 * is not published / not a public type, so the page can 404 cleanly.
 */
export async function getPublishedArticle(slug: string): Promise<NewsroomArticle | null> {
  const id = idFromSlug(slug);
  if (id == null) return null;
  const typePlaceholders = PUBLIC_ARTIFACT_TYPES.map(() => '?').join(', ');

  const db = getAvDb();
  const [rows] = await db.execute<ArticleRow[]>(
    `SELECT a.id, a.tenant_id, a.artifact_type, a.title, a.body_text, a.meta_json,
            a.status, a.created_at, a.updated_at,
            l.company AS company
       FROM content_artifacts a
       LEFT JOIN leads l ON l.id = a.lead_id
      WHERE a.id = ?
        AND a.status = 'published'
        AND a.artifact_type IN (${typePlaceholders})
      LIMIT 1`,
    [id, ...PUBLIC_ARTIFACT_TYPES]
  );
  return rows[0] ? rowToArticle(rows[0]) : null;
}
