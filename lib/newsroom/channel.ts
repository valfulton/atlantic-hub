/**
 * Per-client channel data — the "shareable sales asset" surface on the Wire.
 * Mirrors the IA from Atlantic_Hub_Playbook/newsroom_sitemap.html:
 *
 *   /newsroom                          (the network)
 *     └─ /newsroom/channel/[slug]      ← THIS layer
 *           └─ /newsroom/[article-slug]
 *
 * One channel = one client. We pull:
 *   - clients row (name, slug, industry)
 *   - brand kit from brief_payload (logo, tagline)
 *   - published content_artifacts attributed to this client via leads.company
 *   - a lightweight active-campaign count
 *
 * NOTE on schema: the published-content table is `content_artifacts`
 * (status='published'), NOT a hypothetical `artifacts` table. We delegate the
 * row-shaping to `listPublishedArticles` and filter by company in app code so
 * channel.ts stays small + schema-safe.
 */
import { getAvDb } from '@/lib/db/av';
import { getBriefPayload } from '@/lib/client/brief_store';
import { listPublishedArticles, type NewsroomArticle } from './published';
import type { RowDataPacket } from 'mysql2';

export interface Channel {
  clientId: number;
  clientName: string;
  clientSlug: string;
  industry: string | null;
  /** Brand kit — pulled from brief_payload, fall back to nulls. */
  logoUrl: string | null;
  coverUrl: string | null;
  tagline: string | null;
  /** Counts */
  segmentCount: number;
  liveCampaignCount: number;
}

/** Get a channel by slug. Returns null on miss so the page can notFound(). */
export async function getChannelBySlug(slug: string): Promise<Channel | null> {
  const safe = slug.trim().toLowerCase();
  if (!safe) return null;
  const pool = getAvDb();

  type ClientRow = RowDataPacket & {
    client_id: number;
    client_name: string;
    client_slug: string;
    industry: string | null;
  };
  const [rows] = await pool.execute<ClientRow[]>(
    `SELECT client_id, client_name, client_slug, industry
       FROM clients
      WHERE client_slug = ? AND COALESCE(enabled, 1) = 1
      LIMIT 1`,
    [safe]
  );
  const row = rows[0];
  if (!row) return null;

  let brief: Record<string, unknown> | null = null;
  try {
    brief = (await getBriefPayload('av', row.client_id)) as Record<string, unknown> | null;
  } catch {
    brief = null;
  }
  const logoUrl = pickString(brief, 'logo_url');
  const coverUrl = pickString(brief, 'cover_url') ?? pickString(brief, 'hero_image');
  const tagline =
    pickString(brief, 'slogan') ??
    pickString(brief, 'tagline') ??
    pickString(brief, 'elevator_pitch');

  // Segment count — published content_artifacts attributed via leads.company.
  let segmentCount = 0;
  let liveCampaignCount = 0;
  try {
    type CountRow = RowDataPacket & { n: number };
    const [segRows] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS n
         FROM content_artifacts a
         LEFT JOIN leads l ON l.id = a.lead_id
        WHERE a.status = 'published'
          AND a.artifact_type IN ('blog_article','seo_article','own_brand_post','press_release')
          AND l.company = ?`,
      [row.client_name]
    );
    segmentCount = Number(segRows[0]?.n ?? 0);

    // Active narrative lines (campaigns) for this client. Table is narrative_lanes
    // with a `state` column (lifecycle: candidate/active/reinforcing/retiring).
    const [campRows] = await pool.execute<CountRow[]>(
      `SELECT COUNT(*) AS n
         FROM narrative_lanes
        WHERE client_id = ? AND state IN ('active', 'reinforcing')`,
      [row.client_id]
    );
    liveCampaignCount = Number(campRows[0]?.n ?? 0);
  } catch {
    // Best-effort counts; show 0 if either table/column shifts.
  }

  return {
    clientId: row.client_id,
    clientName: row.client_name,
    clientSlug: row.client_slug,
    industry: row.industry,
    logoUrl,
    coverUrl,
    tagline,
    segmentCount,
    liveCampaignCount
  };
}

/**
 * List published articles attributed to this channel. We fetch the full
 * recent feed via `listPublishedArticles` and filter by company in app code,
 * which keeps the schema knowledge in one file (published.ts).
 */
export async function listChannelArticles(channel: Channel, limit = 24): Promise<NewsroomArticle[]> {
  // Pull a generous slice so the filter doesn't starve when the channel
  // is mid-list. 100 is the upper bound enforced by listPublishedArticles.
  const all = await listPublishedArticles({ limit: 100 });
  const target = channel.clientName.trim().toLowerCase();
  const filtered = all.filter(
    (a) => a.company && a.company.trim().toLowerCase() === target
  );
  return filtered.slice(0, Math.max(1, Math.min(50, Math.floor(limit))));
}

/** List all channels that have at least one published article. */
export async function listChannels(): Promise<Pick<Channel, 'clientName' | 'clientSlug' | 'segmentCount'>[]> {
  const pool = getAvDb();
  try {
    type Row = RowDataPacket & {
      client_name: string;
      client_slug: string;
      n: number;
    };
    const [rows] = await pool.execute<Row[]>(
      `SELECT c.client_name, c.client_slug, COUNT(a.id) AS n
         FROM clients c
         LEFT JOIN leads l ON l.client_id = c.client_id
         LEFT JOIN content_artifacts a ON a.lead_id = l.id
                                       AND a.status = 'published'
                                       AND a.artifact_type IN ('blog_article','seo_article','own_brand_post','press_release')
        WHERE COALESCE(c.enabled, 1) = 1
          AND c.client_slug NOT IN ('av-internal')
        GROUP BY c.client_id, c.client_name, c.client_slug
        HAVING n > 0
        ORDER BY n DESC, c.client_name ASC`
    );
    return rows.map((r) => ({
      clientName: r.client_name,
      clientSlug: r.client_slug,
      segmentCount: Number(r.n)
    }));
  } catch {
    // If the schema shifts under us, the Stories row degrades silently — the
    // /newsroom index still shows hero + Trending + Briefs from articles.
    return [];
  }
}

/* helpers */

function pickString(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}
