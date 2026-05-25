/**
 * app/admin/social/calendar/timeline.ts
 *
 * The campaign-orchestration READ LAYER. This is NOT a passive social-content
 * calendar -- it is the spine of a unified operational timeline.
 *
 * v1 maps social_outbox into the normalized TimelineItem shape
 * ({ when, type, status, tenant, leadId, title, link }). PR pitches/releases,
 * outreach, commercials, launches and seasonal initiatives map into the SAME
 * shape later, so adding sources is additive, not a rewrite. We deliberately do
 * NOT pull those other sources in yet (see kickoff scope).
 *
 * Server-only (uses getAvDb). Owner/staff surfaces read this.
 */
import { getAvDb } from '@/lib/db/av';
import { articleSlug } from '@/lib/newsroom/published';
import type { RowDataPacket } from 'mysql2';
import type { TimelineItem, TimelineItemStatus } from '@/lib/pr/types';

interface OutboxRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  lead_id: number | null;
  status: string;
  scheduled_for: string | null;
  published_at: string | null;
  created_at: string;
  provider: string | null;
  provider_url: string | null;
  company: string | null;
  body_text: string | null;
  media_url: string | null;
  media_type: string | null;
  error_message: string | null;
}

const VALID_STATUSES: TimelineItemStatus[] = [
  'draft',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'canceled'
];

function normalizeStatus(s: string): TimelineItemStatus {
  return (VALID_STATUSES as string[]).includes(s) ? (s as TimelineItemStatus) : 'draft';
}

const PROVIDER_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  threads: 'Threads',
  tiktok: 'TikTok',
  youtube: 'YouTube'
};

/** Map one social_outbox row into the normalized timeline item shape. */
function mapOutbox(r: OutboxRow): TimelineItem {
  const when = r.scheduled_for || r.published_at || r.created_at;
  const provider = r.provider ? PROVIDER_LABELS[r.provider] ?? r.provider : 'Social';
  const titleParts = [`${provider} post`];
  if (r.company) titleParts.push(`for ${r.company}`);
  return {
    id: `social:${r.id}`,
    when,
    type: 'social',
    status: normalizeStatus(r.status),
    tenant: r.tenant_id,
    leadId: r.lead_id,
    title: titleParts.join(' '),
    link: r.provider_url,
    outboxId: r.id,
    bodyText: r.body_text,
    mediaUrl: r.media_url,
    mediaType: r.media_type,
    providerLabel: provider,
    errorMessage: r.error_message
  };
}

/**
 * Fetch timeline items in a date window. v1 source = social_outbox only.
 * @param opts.from / opts.to  inclusive ISO date bounds (YYYY-MM-DD) on `when`.
 * @param opts.tenant          optional tenant filter.
 */
export async function fetchTimelineItems(opts: {
  from: string;
  to: string;
  tenant?: string | null;
}): Promise<TimelineItem[]> {
  const db = getAvDb();
  const where: string[] = [
    "COALESCE(o.scheduled_for, o.published_at, o.created_at) >= ?",
    "COALESCE(o.scheduled_for, o.published_at, o.created_at) < ?",
    'o.archived_at IS NULL'
  ];
  const vals: unknown[] = [opts.from, opts.to];
  if (opts.tenant) {
    where.push('o.tenant_id = ?');
    vals.push(opts.tenant);
  }

  const [rows] = await db.execute<OutboxRow[]>(
    `SELECT o.id, o.tenant_id, o.lead_id, o.status, o.scheduled_for, o.published_at,
            o.created_at, c.provider, o.provider_url, l.company,
            o.body_text, o.media_url, o.media_type, o.error_message
       FROM social_outbox o
       LEFT JOIN social_connections c ON c.id = o.connection_id
       LEFT JOIN leads l ON l.id = o.lead_id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(o.scheduled_for, o.published_at, o.created_at) ASC
      LIMIT 1000`,
    vals
  );

  const social = rows.map(mapOutbox);

  // Also surface PUBLISHED owned content (blogs, guides, own-brand posts, press
  // releases) on the timeline, anchored to their publish date, so the calendar
  // shows everything that went out — not just social. Read-only (no outboxId);
  // links to the public newsroom. client_deliverable (private) is excluded.
  const content = await fetchContentItems(opts);

  return [...social, ...content].sort((a, b) => (a.when < b.when ? -1 : a.when > b.when ? 1 : 0));
}

interface ContentRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  artifact_type: string;
  title: string | null;
  body_text: string | null;
  updated_at: string;
}

const CONTENT_TYPE_LABEL: Record<string, string> = {
  blog_article: 'Blog',
  seo_article: 'Guide',
  own_brand_post: 'Post',
  press_release: 'Press release'
};

/** Published owned content artifacts -> read-only timeline items by publish date. */
async function fetchContentItems(opts: { from: string; to: string; tenant?: string | null }): Promise<TimelineItem[]> {
  const db = getAvDb();
  const where: string[] = [
    "a.status = 'published'",
    "a.artifact_type IN ('blog_article','seo_article','own_brand_post','press_release')",
    'a.updated_at >= ?',
    'a.updated_at < ?'
  ];
  const vals: unknown[] = [opts.from, opts.to];
  if (opts.tenant) { where.push('a.tenant_id = ?'); vals.push(opts.tenant); }

  const [rows] = await db.execute<ContentRow[]>(
    `SELECT a.id, a.tenant_id, a.artifact_type, a.title, a.body_text, a.updated_at
       FROM content_artifacts a
      WHERE ${where.join(' AND ')}
      ORDER BY a.updated_at ASC
      LIMIT 1000`,
    vals
  );

  return rows.map((r) => {
    const title = (r.title && r.title.trim()) || 'Untitled';
    const label = CONTENT_TYPE_LABEL[r.artifact_type] ?? 'Content';
    return {
      id: `content:${r.id}`,
      when: r.updated_at,
      type: r.artifact_type === 'press_release' ? 'pr_release' : 'content',
      status: 'published',
      tenant: r.tenant_id,
      leadId: null,
      title: `${label}: ${title}`,
      link: `/newsroom/${articleSlug(title, r.id)}`,
      bodyText: r.body_text
    } satisfies TimelineItem;
  });
}

/** Distinct tenants present in social_outbox, for the filter chips. */
export async function fetchTimelineTenants(): Promise<string[]> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { tenant_id: string })[]>(
    `SELECT DISTINCT tenant_id FROM social_outbox WHERE archived_at IS NULL ORDER BY tenant_id`
  );
  return rows.map((r) => r.tenant_id);
}
