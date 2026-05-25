/**
 * POST /api/admin/pr/releases/[id]/approve
 *
 * Advance a release through its lifecycle: draft -> approved -> published.
 * Body: { status?: 'approved' | 'published' } (defaults to 'approved').
 *
 * Owner + staff only. Emits pr.release.approved / pr.release.published.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import { PR_EVENTS } from '@/lib/pr/types';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

interface ReleaseRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  lead_id: number | null;
  status: string;
  title: string | null;
  body_text: string | null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/pr/releases/[id]/approve:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty body -> default approve
  }
  const target = body.status === 'published' ? 'published' : 'approved';

  try {
    const db = getAvDb();
    const [rows] = await db.execute<ReleaseRow[]>(
      `SELECT id, tenant_id, lead_id, status, title, body_text FROM press_releases WHERE id = ? LIMIT 1`,
      [id]
    );
    const rel = rows[0];
    if (!rel) return NextResponse.json({ error: 'release not found' }, { status: 404 });

    // Guard the lifecycle order.
    if (target === 'approved' && rel.status !== 'draft') {
      return NextResponse.json({ error: `cannot approve a ${rel.status} release` }, { status: 409 });
    }
    if (target === 'published' && rel.status === 'draft') {
      return NextResponse.json({ error: 'approve the release before publishing' }, { status: 409 });
    }

    await db.execute<ResultSetHeader>(
      `UPDATE press_releases SET status = ?, updated_at = NOW() WHERE id = ?`,
      [target, id]
    );

    // PR -> NEWSROOM: when a release goes approved -> published, mirror it into
    // content_artifacts as a published 'press_release' so it appears in the public
    // newsroom. One-time (only on the approved->published hop) so re-publishing
    // can't duplicate. Non-fatal: the release is published regardless.
    if (target === 'published' && rel.status === 'approved') {
      try {
        await db.execute<ResultSetHeader>(
          `INSERT INTO content_artifacts
             (tenant_id, artifact_type, lead_id, opportunity_id, voice_mode, title, body_text,
              meta_json, model, status, created_by_user_id, campaign_id)
           VALUES (?, 'press_release', ?, NULL, 'client_voice', ?, ?, CAST(? AS JSON), NULL, 'published', ?, NULL)`,
          [
            rel.tenant_id,
            rel.lead_id,
            (rel.title ?? 'Press release').slice(0, 300),
            rel.body_text ?? '',
            JSON.stringify({ source: 'press_release', release_id: id }),
            guard.actor.userId
          ]
        );
      } catch (e) {
        console.error('[pr:releases:newsroom-publish]', (e as Error).message);
      }
    }

    await logEvent({
      eventType: target === 'published' ? PR_EVENTS.releasePublished : PR_EVENTS.releaseApproved,
      leadId: rel.lead_id,
      userId: guard.actor.userId,
      source: 'pr_desk',
      payload: { release_id: id, from: rel.status, to: target }
    });

    return NextResponse.json({ ok: true, id, status: target });
  } catch (err) {
    console.error('[pr:releases:approve]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
