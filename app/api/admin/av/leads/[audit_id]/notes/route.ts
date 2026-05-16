/**
 * GET  /api/admin/av/leads/[audit_id]/notes  — list notes for a lead (newest first)
 * POST /api/admin/av/leads/[audit_id]/notes  — create a note; also writes a lead_events row
 *
 * Mirrors the read-side pattern in app/api/admin/av/leads/[audit_id]/route.ts:
 *   guardAdminRequest → role check → tab_av_enabled flag → DB call → JSON response.
 *
 * Schema reference (schema/004_av_detail_v4.sql, D.3 + D.4):
 *   lead_notes  (lead_note_id, client_id, lead_id INT, author_user_id, author_role ENUM, body TEXT, is_internal BOOL, created_at)
 *   lead_events (lead_event_id, client_id, lead_id INT, event_type ENUM, event_payload JSON, actor_user_id, actor_role, occurred_at)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface NoteRow extends RowDataPacket {
  lead_note_id: number;
  body: string;
  author_user_id: number | null;
  author_role: string;
  is_internal: number;
  created_at: string;
}

interface LeadIdRow extends RowDataPacket {
  id: number;
  client_id: number | null;
}

async function resolveLeadIdByAuditId(auditId: string) {
  const db = getAvDb();
  const [rows] = await db.execute<LeadIdRow[]>(
    'SELECT id, client_id FROM leads WHERE audit_id = ? LIMIT 1',
    [auditId]
  );
  return rows[0] ?? null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { audit_id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/notes',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }
  if (!UUID_RE.test(params.audit_id)) {
    return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });
  }

  try {
    const lead = await resolveLeadIdByAuditId(params.audit_id);
    if (!lead) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const db = getAvDb();
    const [rows] = await db.execute<NoteRow[]>(
      `SELECT lead_note_id, body, author_user_id, author_role, is_internal, created_at
         FROM lead_notes
        WHERE lead_id = ?
        ORDER BY created_at DESC
        LIMIT 200`,
      [lead.id]
    );

    const notes = rows.map((r) => ({
      noteId: r.lead_note_id,
      body: r.body,
      authorUserId: r.author_user_id,
      authorRole: r.author_role,
      isInternal: r.is_internal === 1,
      createdAt: r.created_at
    }));

    return NextResponse.json({ notes });
  } catch (err) {
    console.error('[av:notes:get]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { audit_id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/notes',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }
  if (!UUID_RE.test(params.audit_id)) {
    return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });
  }

  let payload: { body?: unknown; isInternal?: unknown } = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!body || body.length > 8000) {
    return NextResponse.json({ error: 'body required, max 8000 chars' }, { status: 400 });
  }
  const isInternal = payload.isInternal === true ? 1 : 0;

  // Map atlantic-hub roles to lead_notes.author_role ENUM
  // ENUM values: 'owner','operator','client_user','system'
  const roleMap: Record<string, 'owner' | 'operator' | 'client_user' | 'system'> = {
    owner: 'owner',
    staff: 'operator',
    client_user: 'client_user'
  };
  const authorRole = roleMap[guard.actor.role] ?? 'operator';

  try {
    const lead = await resolveLeadIdByAuditId(params.audit_id);
    if (!lead) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const db = getAvDb();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [noteResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO lead_notes (client_id, lead_id, author_user_id, author_role, body, is_internal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [lead.client_id, lead.id, guard.actor.userId, authorRole, body, isInternal]
      );

      await conn.execute<ResultSetHeader>(
        `INSERT INTO lead_events (client_id, lead_id, event_type, event_payload, actor_user_id, actor_role)
         VALUES (?, ?, 'note_added', ?, ?, ?)`,
        [
          lead.client_id,
          lead.id,
          JSON.stringify({ noteId: noteResult.insertId, isInternal: isInternal === 1, length: body.length }),
          guard.actor.userId,
          authorRole
        ]
      );

      // Bump last_activity_at on the lead so the leads list re-ranks correctly.
      await conn.execute<ResultSetHeader>(
        `UPDATE leads SET last_activity_at = NOW() WHERE id = ?`,
        [lead.id]
      );

      await conn.commit();

      return NextResponse.json({
        note: {
          noteId: noteResult.insertId,
          body,
          authorUserId: guard.actor.userId,
          authorRole,
          isInternal: isInternal === 1,
          createdAt: new Date().toISOString()
        }
      }, { status: 201 });
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[av:notes:post]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
