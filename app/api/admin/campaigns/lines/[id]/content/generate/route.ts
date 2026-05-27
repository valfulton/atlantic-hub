/**
 * POST /api/admin/campaigns/lines/[id]/content/generate
 *
 * Push a narrative line OUTWARD: generate a piece of written content (a brand
 * post or a blog) GROUNDED IN THE LINE'S THESIS, then link it back to the line
 * so it shows on the Story Map as advancing that story. This is the payoff of
 * the spine — the operator picks the story and the system writes from it.
 *
 * The line's tenant/client own the content (lead_id NULL = the brand/house or a
 * client's own line). Drafts via the same artifact drafter the PR desk uses, so
 * derived intelligence still compounds. Owner + staff only.
 *
 * Body: { kind?: 'post' | 'blog' }  (default 'post')
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { getLane } from '@/lib/campaigns/store';
import { linkAssetToLine } from '@/lib/campaigns/line_links';
import { draftArtifact } from '@/lib/pr/artifacts';
import type { ArtifactType, PitchMode } from '@/lib/pr/types';
import type { ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/lines/content/generate:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const lineId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(lineId) || lineId <= 0) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });

  let body: { kind?: unknown } = {};
  try { body = (await req.json()) as { kind?: unknown }; } catch { /* defaults */ }
  const artifactType: ArtifactType = body.kind === 'blog' ? 'blog_article' : 'own_brand_post';

  const line = await getLane(lineId);
  if (!line) return NextResponse.json({ error: 'line not found' }, { status: 404 });

  // Build the narrative-context block the drafter grounds on, straight from the
  // line — so the content carries THIS story, not a generic message.
  const ctx: string[] = ['NARRATIVE LINE — write content that ADVANCES this one story (stay on-thesis):'];
  if (line.thesis) ctx.push(`THESIS: ${line.thesis}`);
  if (line.audience) ctx.push(`AUDIENCE: ${line.audience}`);
  if (line.emotionalDriver) ctx.push(`EMOTIONAL DRIVER: ${line.emotionalDriver}`);
  if (line.authorityAngle) ctx.push(`AUTHORITY ANGLE: ${line.authorityAngle}`);
  if (Array.isArray(line.proofPoints) && line.proofPoints.length) ctx.push(`PROOF POINTS: ${line.proofPoints.join('; ')}`);
  if (Array.isArray(line.doSay) && line.doSay.length) ctx.push(`SAY (on-thesis): ${line.doSay.join('; ')}`);
  if (Array.isArray(line.dontSay) && line.dontSay.length) ctx.push(`DO NOT SAY (off-thesis): ${line.dontSay.join('; ')}`);
  const narrativeContext = ctx.join('\n');

  try {
    const drafted = await draftArtifact({
      artifactType,
      tenantId: line.tenantId,
      leadId: null,
      topic: line.thesis ?? null,
      narrativeContext,
      voiceMode: 'client_voice' as PitchMode
    });

    const db = getAvDb();
    const [ins] = await db.execute<ResultSetHeader>(
      `INSERT INTO content_artifacts
         (tenant_id, artifact_type, lead_id, voice_mode, title, body_text, meta_json, model, status, created_by_user_id, campaign_id)
       VALUES (?, ?, NULL, ?, ?, ?, CAST(? AS JSON), ?, 'draft', ?, NULL)`,
      [
        line.tenantId,
        artifactType,
        drafted.voiceMode,
        drafted.title || null,
        drafted.bodyText,
        JSON.stringify({ source: 'narrative_line', narrative_line_id: lineId, ...(drafted.metaJson ?? {}) }),
        drafted.model,
        guard.actor.userId
      ]
    );
    const id = ins.insertId;

    // Link it to the line as 'advances' (it was born from the story).
    await linkAssetToLine({
      tenantId: line.tenantId,
      narrativeLineId: lineId,
      assetType: 'content_artifact',
      assetId: id,
      role: 'advances',
      createdByUserId: guard.actor.userId
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      artifact: { id, artifactType, title: drafted.title ?? null, bodyText: drafted.bodyText }
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'generation failed', detail: ((err as Error).message || '').slice(0, 300), errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}
