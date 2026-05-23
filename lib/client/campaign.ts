/**
 * lib/client/campaign.ts
 *
 * The client hub's "Your Campaign" feed: the content the platform has produced
 * FOR a specific paying client. This is the private, scoped counterpart to the
 * public newsroom (lib/newsroom/published.ts).
 *
 * SCOPING / SAFETY: we only return content_artifacts whose lead_id belongs to
 * THIS client -- i.e. leads matched by client_id (preferred) or the client's
 * email. Prospect-targeting "idea" drafts are attached to cold leads that have
 * no client_id and do not match the client's email, so they can never surface
 * here. That join is the privacy wall. Own-brand posts (lead_id NULL) are the
 * agency's own newsroom content and are likewise excluded.
 *
 * Read-only. Called from the client portal server components, which middleware
 * has already authenticated as a client_user.
 */
import { getAvDb } from '@/lib/db/av';
import { articleSlug } from '@/lib/newsroom/published';
import type { RowDataPacket } from 'mysql2';

/** Public artifact types that, once published, are live on the newsroom. */
const PUBLIC_TYPES = new Set(['blog_article', 'seo_article', 'own_brand_post']);

export type CampaignStage = 'in_progress' | 'ready' | 'live';

export interface CampaignContentItem {
  id: number;
  artifactType: string;
  typeLabel: string;
  title: string;
  excerpt: string;
  stage: CampaignStage;
  stageLabel: string;
  updatedAt: string | null;
  /** Set only when the piece is published AND a public newsroom type. */
  liveHref: string | null;
}

interface ContentRow extends RowDataPacket {
  id: number;
  artifact_type: string;
  title: string | null;
  body_text: string | null;
  status: string;
  updated_at: Date | string | null;
  created_at: Date | string | null;
}

const TYPE_LABEL: Record<string, string> = {
  blog_article: 'Blog post',
  seo_article: 'SEO guide',
  own_brand_post: 'Social post',
  client_deliverable: 'Deliverable'
};

function stageFor(status: string): { stage: CampaignStage; label: string } {
  if (status === 'published') return { stage: 'live', label: 'Live' };
  if (status === 'approved') return { stage: 'ready', label: 'Ready to publish' };
  return { stage: 'in_progress', label: 'In progress' };
}

function excerptOf(body: string | null, max = 180): string {
  if (!body) return '';
  const flat = body
    .replace(/\r\n/g, '\n')
    .split('\n')
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

/**
 * Content produced for this client, newest first. Drafts/approved/published are
 * all shown so the client sees momentum (work in flight, not just what shipped);
 * dismissed ('passed') work is hidden.
 */
export async function listClientCampaignContent(user: {
  client_id: number | null;
  email: string;
}): Promise<CampaignContentItem[]> {
  const db = getAvDb();
  const [rows] = await db.execute<ContentRow[]>(
    `SELECT a.id, a.artifact_type, a.title, a.body_text, a.status,
            a.updated_at, a.created_at
       FROM content_artifacts a
       JOIN leads l ON l.id = a.lead_id
      WHERE a.status <> 'passed'
        AND l.archived_at IS NULL
        AND (
          (? IS NOT NULL AND l.client_id = ?)
          OR l.email = ?
        )
      ORDER BY a.updated_at DESC, a.id DESC
      LIMIT 40`,
    [user.client_id, user.client_id, user.email]
  );

  return rows.map((r) => {
    const { stage, label } = stageFor(r.status);
    const title = (r.title && r.title.trim()) || 'Untitled';
    const isLivePublic = r.status === 'published' && PUBLIC_TYPES.has(r.artifact_type);
    return {
      id: r.id,
      artifactType: r.artifact_type,
      typeLabel: TYPE_LABEL[r.artifact_type] ?? 'Content',
      title,
      excerpt: excerptOf(r.body_text),
      stage,
      stageLabel: label,
      updatedAt: toIso(r.updated_at) || toIso(r.created_at),
      liveHref: isLivePublic ? `/newsroom/${articleSlug(title, r.id)}` : null
    };
  });
}
