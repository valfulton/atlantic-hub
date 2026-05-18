/**
 * POST /api/admin/av/leads/[auditId]/notes
 *   Body: { body, isInternal?: boolean }
 *
 *   author_role is derived from the platform role (not provided by the
 *   caller) so a client_user can't impersonate an owner-authored note.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { resolveLeadByAuditId } from '@/lib/av/leads';
import {
  writeLeadEvent,
  mapPlatformRoleToAvActorRole
} from '@/lib/av/events';
import { writeAuditRow, extractClientIp } from '@/lib/audit';
import type { ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

interface AddNoteBody {
  body?: string;
  isInternal?: boolean;
}

export async function POST(req: NextRequest, ctx: { params: { auditId: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: `/api/admin/av/leads/${ctx.params.auditId}/notes`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 503 });
  }

  let payload: AddNoteBody;
  try {
    payload = (await req.json()) as AddNoteBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const noteBody = (payload.body || '').trim();
  if (!noteBody) {
    return NextResponse.json({ error: 'body required' }, { status: 400 });
  }
  if (noteBody.length > 10_000) {
    return NextResponse.json({ error: 'body too long (max 10000)' }, { status: 400 });
  }

  const resolved = await resolveLeadByAuditId(ctx.params.auditId);
  if (!resolved) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const avActorRole = mapPlatformRoleToAvActorRole(guard.actor.role);
  const isInternal = Boolean(payload.isInternal);

  try {
    const db = getAvDb();
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO lead_notes
         (client_id, lead_id, author_user_id, author_role, body, is_internal)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        resolved.client.clientId,
        resolved.leadId,
        guard.actor.userId,
        avActorRole,
        noteBody,
        isInternal
      ]
    );

    await db.execute(
      `UPDATE leads SET last_activity_at = CURRENT_TIMESTAMP WHERE lead_id = ?`,
      [resolved.leadId]
    );

    await writeLeadEvent({
      clientId: resolved.client.clientId,
      leadId: resolved.leadId,
      eventType: 'note_added',
      payload: { noteId: result.insertId, isInternal },
      actorUserId: guard.actor.userId,
      actorRole: avActorRole
    });

    await writeAuditRow({
      actorUserId: guard.actor.userId,
      actorRole: guard.actor.role,
      tenantId: 'av',
      targetResource: `/api/admin/av/leads/${ctx.params.auditId}/notes`,
      action: 'av_lead_note_added',
      ip: extractClientIp(req.headers),
      userAgent: req.headers.get('user-agent'),
      statusCode: 201
    });

    return NextResponse.json({ noteId: result.insertId }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}
