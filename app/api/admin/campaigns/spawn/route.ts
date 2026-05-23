/**
 * POST /api/admin/campaigns/spawn
 *
 * "Create once, distribute everywhere." From a single topic/idea, in one click:
 *   1. create a campaign (in a lane, optionally for a client lead)
 *   2. draft a blog_article into it
 *   3. draft an own_brand_post (social) into it
 * Both pieces are assigned to the campaign (campaign_id) so they compile up into
 * the lane. Drafts only -- nothing publishes (the approval/branding gate stands).
 *
 * Body: { name, topic?, goal?, laneId?, leadId?, tenant? }
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import { createCampaign } from '@/lib/campaigns/store';
import { draftArtifact } from '@/lib/pr/artifacts';
import { DEFAULT_TENANT, CONTENT_EVENTS, type ArtifactType, type PitchMode } from '@/lib/pr/types';
import type { ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 90;

async function draftIntoCampaign(args: {
  artifactType: ArtifactType;
  tenantId: string;
  topic: string;
  campaignId: number;
  userId: number | null;
}): Promise<number | null> {
  try {
    const drafted = await draftArtifact({
      artifactType: args.artifactType,
      tenantId: args.tenantId,
      leadId: null, // A&V's own voice; general, never names a prospect
      topic: args.topic,
      voiceMode: 'client_voice' as PitchMode
    });
    const db = getAvDb();
    const [ins] = await db.execute<ResultSetHeader>(
      `INSERT INTO content_artifacts
         (tenant_id, artifact_type, lead_id, voice_mode, title, body_text, meta_json, model, status, created_by_user_id, campaign_id)
       VALUES (?, ?, NULL, ?, ?, ?, CAST(? AS JSON), ?, 'draft', ?, ?)`,
      [
        args.tenantId,
        args.artifactType,
        drafted.voiceMode,
        drafted.title || null,
        drafted.bodyText,
        JSON.stringify(drafted.metaJson ?? {}),
        drafted.model,
        args.userId,
        args.campaignId
      ]
    );
    return ins.insertId;
  } catch (err) {
    console.error('[campaigns:spawn:draft]', (err as Error).message);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/spawn:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const tenantId = typeof body.tenant === 'string' ? body.tenant : DEFAULT_TENANT;
  const laneId = typeof body.laneId === 'number' ? body.laneId : null;
  const leadId = typeof body.leadId === 'number' ? body.leadId : null;
  const goal = typeof body.goal === 'string' ? body.goal : null;
  const topicBase = typeof body.topic === 'string' && body.topic.trim() ? body.topic.trim() : name;

  try {
    const campaignId = await createCampaign({ tenantId, laneId, leadId, name, goal, userId: guard.actor.userId });

    const blogTopic = `A thought-leadership blog article on: ${topicBase}. Write generally for the audience in Atlantic & Vine's own voice; do NOT name a specific company.`;
    const socialTopic = `A short, engaging own-brand social post on: ${topicBase}. Atlantic & Vine's voice; a hook + one idea + a soft CTA.`;

    const blogId = await draftIntoCampaign({ artifactType: 'blog_article', tenantId, topic: blogTopic, campaignId, userId: guard.actor.userId });
    const socialId = await draftIntoCampaign({ artifactType: 'own_brand_post', tenantId, topic: socialTopic, campaignId, userId: guard.actor.userId });

    const drafted = [blogId, socialId].filter((x) => x != null).length;

    await logEvent({
      eventType: CONTENT_EVENTS.artifactDrafted,
      userId: guard.actor.userId,
      source: 'campaign_spawn',
      status: 'success',
      payload: { campaign_id: campaignId, lane_id: laneId, drafted, blog_id: blogId, social_id: socialId }
    });

    return NextResponse.json({ ok: true, campaignId, drafted, blogId, socialId });
  } catch (err) {
    console.error('[campaigns:spawn]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
