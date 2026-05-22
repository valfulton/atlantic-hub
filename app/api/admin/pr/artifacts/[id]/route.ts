/**
 * PATCH /api/admin/pr/artifacts/[id]
 *
 * Edit a drafted artifact's title/body, and/or advance its status. Operators
 * refine the AI draft before approving/publishing. Body/title are editable only
 * while status is draft or approved. Status follows the locked artifact
 * lifecycle (SYSTEM_CONSTITUTION section 3): draft -> approved -> published, and
 * any state -> passed (dismiss).
 *
 * Body (all optional, at least one required):
 *   { title?: string, bodyText?: string, status?: 'approved'|'published'|'passed' }
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import { CONTENT_EVENTS, type ArtifactStatus } from '@/lib/pr/types';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

interface ArtifactRow extends RowDataPacket {
  id: number;
  lead_id: number | null;
  artifact_type: string;
  status: ArtifactStatus;
}

const EVENT_FOR_STATUS: Record<'approved' | 'published' | 'passed', string> = {
  approved: CONTENT_EVENTS.artifactApproved,
  published: CONTENT_EVENTS.artifactPublished,
  passed: CONTENT_EVENTS.artifactPassed
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/artifacts/[id]:PATCH', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : undefined;
  const bodyText = typeof body.bodyText === 'string' ? body.bodyText.trim() : undefined;
  const nextStatus =
    body.status === 'approved' || body.status === 'published' || body.status === 'passed'
      ? (body.status as 'approved' | 'published' | 'passed')
      : undefined;

  if (title === undefined && bodyText === undefined && nextStatus === undefined) {
    return NextResponse.json({ error: 'nothing to update (provide title, bodyText, or status)' }, { status: 400 });
  }

  try {
    const db = getAvDb();
    const [rows] = await db.execute<ArtifactRow[]>(
      `SELECT id, lead_id, artifact_type, status FROM content_artifacts WHERE id = ? LIMIT 1`,
      [id]
    );
    const artifact = rows[0];
    if (!artifact) return NextResponse.json({ error: 'artifact not found' }, { status: 404 });

    // Content edits only while editable.
    const wantsContentEdit = title !== undefined || bodyText !== undefined;
    if (wantsContentEdit && artifact.status !== 'draft' && artifact.status !== 'approved') {
      return NextResponse.json({ error: `cannot edit an artifact in status '${artifact.status}'` }, { status: 409 });
    }

    // Validate status transition (lenient forward-only + dismiss).
    if (nextStatus) {
      const ok =
        nextStatus === 'passed' ||
        (nextStatus === 'approved' && artifact.status === 'draft') ||
        (nextStatus === 'published' && (artifact.status === 'approved' || artifact.status === 'draft'));
      if (!ok) {
        return NextResponse.json({ error: `invalid transition ${artifact.status} -> ${nextStatus}` }, { status: 409 });
      }
    }

    const sets: string[] = [];
    const args: Array<string | number> = [];
    if (title !== undefined) {
      sets.push('title = ?');
      args.push(title);
    }
    if (bodyText !== undefined) {
      if (!bodyText) return NextResponse.json({ error: 'bodyText cannot be empty' }, { status: 400 });
      sets.push('body_text = ?');
      args.push(bodyText);
    }
    if (nextStatus !== undefined) {
      sets.push('status = ?');
      args.push(nextStatus);
    }
    sets.push('updated_at = NOW()');
    args.push(id);

    await db.execute<ResultSetHeader>(
      `UPDATE content_artifacts SET ${sets.join(', ')} WHERE id = ?`,
      args
    );

    // Emit the most meaningful event for this change.
    if (nextStatus) {
      await logEvent({
        eventType: EVENT_FOR_STATUS[nextStatus],
        leadId: artifact.lead_id,
        userId: guard.actor.userId,
        source: 'pr_desk',
        payload: { artifact_id: id, artifact_type: artifact.artifact_type, from: artifact.status, to: nextStatus }
      });
    } else if (wantsContentEdit) {
      await logEvent({
        eventType: CONTENT_EVENTS.artifactEdited,
        leadId: artifact.lead_id,
        userId: guard.actor.userId,
        source: 'pr_desk',
        payload: { artifact_id: id, artifact_type: artifact.artifact_type }
      });
    }

    return NextResponse.json({
      ok: true,
      id,
      title,
      bodyText,
      status: nextStatus ?? artifact.status
    });
  } catch (err) {
    console.error('[pr:artifacts:patch]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
