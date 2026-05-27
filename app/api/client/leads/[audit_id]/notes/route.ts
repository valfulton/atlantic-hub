/**
 * /api/client/leads/[audit_id]/notes
 *
 * The CLIENT-facing notes for one of THEIR leads. Like the client calls route:
 *   - authenticates as a client_user (middleware sets x-ah-client-user-id),
 *   - scopes STRICTLY to the client's own account (lead.client_id must match),
 *   - PRIVACY: only ever returns NON-internal notes (is_internal = 0). Operator
 *     internal notes (is_internal = 1) are never shown to the client. Notes the
 *     client creates are always non-internal and authored as 'client_user'
 *     (author_user_id NULL — a client isn't an admin user).
 *
 * GET  list this lead's client-visible notes (newest first, capped 200)
 * POST add a note. Body: { body }
 */
import { NextRequest, NextResponse } from 'next/server';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface NoteRow extends RowDataPacket {
  lead_note_id: number;
  body: string;
  author_role: string;
  created_at: string;
}

async function ownedLead(auditId: string, clientId: number): Promise<{ id: number } | null> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE audit_id = ? AND client_id = ? AND archived_at IS NULL LIMIT 1`,
    [auditId, clientId]
  );
  return rows[0] ? { id: rows[0].id } : null;
}

async function resolveClient(req: NextRequest) {
  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) return null;
  const user = await findClientUserById(actor.clientUserId);
  if (!user) return null;
  let clientId = user.client_id;
  if (!clientId) {
    try { clientId = await ensureClientHub(user); } catch { clientId = null; }
  }
  return clientId && clientId > 0 ? { clientId } : null;
}

export async function GET(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const client = await resolveClient(req);
  if (!client) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!UUID_RE.test(params.audit_id)) return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });

  const lead = await ownedLead(params.audit_id, client.clientId);
  if (!lead) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

  const db = getAvDb();
  const [rows] = await db.execute<NoteRow[]>(
    `SELECT lead_note_id, body, author_role, created_at
       FROM lead_notes
      WHERE lead_id = ? AND is_internal = 0
      ORDER BY created_at DESC
      LIMIT 200`,
    [lead.id]
  );
  return NextResponse.json({
    notes: rows.map((r) => ({
      noteId: r.lead_note_id,
      body: r.body,
      authorRole: r.author_role,
      createdAt: r.created_at
    }))
  });
}

export async function POST(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const client = await resolveClient(req);
  if (!client) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!UUID_RE.test(params.audit_id)) return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });

  const lead = await ownedLead(params.audit_id, client.clientId);
  if (!lead) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

  let payload: { body?: unknown } = {};
  try { payload = await req.json(); } catch { return NextResponse.json({ error: 'invalid json body' }, { status: 400 }); }
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!body || body.length > 8000) {
    return NextResponse.json({ error: 'body required, max 8000 chars' }, { status: 400 });
  }

  const db = getAvDb();
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO lead_notes (client_id, lead_id, author_user_id, author_role, body, is_internal)
     VALUES (?, ?, NULL, 'client_user', ?, 0)`,
    [client.clientId, lead.id, body]
  );
  await db.execute<ResultSetHeader>(`UPDATE leads SET last_activity_at = NOW() WHERE id = ?`, [lead.id]);

  return NextResponse.json(
    {
      note: {
        noteId: result.insertId,
        body,
        authorRole: 'client_user',
        createdAt: new Date().toISOString()
      }
    },
    { status: 201 }
  );
}
