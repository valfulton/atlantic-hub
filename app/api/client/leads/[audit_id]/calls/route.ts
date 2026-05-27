/**
 * /api/client/leads/[audit_id]/calls
 *
 * The CLIENT-facing call log for one of THEIR leads. Mirrors the operator route
 * (/api/admin/av/leads/[audit_id]/calls) but:
 *   - authenticates as a client_user (middleware sets x-ah-client-user-id), and
 *   - scopes STRICTLY to the client's own account: the lead must have
 *     client_id = <this client's id>, or it's a 404. A client can never log a
 *     call against the operator pipeline or another client's lead.
 *   - stores user_id = NULL (call_log.user_id is an admin id; a client isn't one).
 *
 * GET  list calls for the lead (most recent first, capped 100)
 * POST log a call. Body: { outcome, durationSeconds?, notes? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_OUTCOMES = new Set([
  'connected',
  'voicemail',
  'no_answer',
  'wrong_number',
  'not_interested',
  'follow_up',
  'meeting_booked',
  'converted',
  'other'
]);

interface CallRow extends RowDataPacket {
  call_log_id: number;
  outcome: string;
  duration_seconds: number | null;
  notes: string | null;
  called_at: string;
}

/** Resolve the lead id for this audit_id ONLY if it belongs to this client. */
async function ownedLeadId(auditId: string, clientId: number): Promise<number | null> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE audit_id = ? AND client_id = ? AND archived_at IS NULL LIMIT 1`,
    [auditId, clientId]
  );
  return rows.length === 0 ? null : rows[0].id;
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

  const leadId = await ownedLeadId(params.audit_id, client.clientId);
  if (leadId === null) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

  const db = getAvDb();
  const [rows] = await db.execute<CallRow[]>(
    `SELECT call_log_id, outcome, duration_seconds, notes, called_at
       FROM call_log WHERE lead_id = ?
      ORDER BY called_at DESC, call_log_id DESC LIMIT 100`,
    [leadId]
  );
  return NextResponse.json({
    calls: rows.map((r) => ({
      callLogId: r.call_log_id,
      outcome: r.outcome,
      durationSeconds: r.duration_seconds,
      notes: r.notes,
      calledAt: r.called_at
    }))
  });
}

export async function POST(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const client = await resolveClient(req);
  if (!client) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!UUID_RE.test(params.audit_id)) return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });

  const leadId = await ownedLeadId(params.audit_id, client.clientId);
  if (leadId === null) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { return NextResponse.json({ error: 'invalid json body' }, { status: 400 }); }

  const outcome = typeof payload.outcome === 'string' ? payload.outcome : '';
  if (!VALID_OUTCOMES.has(outcome)) {
    return NextResponse.json({ error: 'invalid outcome', validOutcomes: Array.from(VALID_OUTCOMES) }, { status: 400 });
  }
  const durationSeconds =
    typeof payload.durationSeconds === 'number' && Number.isFinite(payload.durationSeconds) && payload.durationSeconds >= 0
      ? Math.min(7200, Math.floor(payload.durationSeconds))
      : null;
  const notes = typeof payload.notes === 'string' ? payload.notes.slice(0, 4000) : null;

  const db = getAvDb();
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO call_log (lead_id, user_id, outcome, duration_seconds, notes) VALUES (?, NULL, ?, ?, ?)`,
    [leadId, outcome, durationSeconds, notes]
  );

  await db.execute<ResultSetHeader>(`UPDATE leads SET last_activity_at = NOW() WHERE id = ?`, [leadId]);

  const engagementEventType =
    outcome === 'meeting_booked' ? 'lead.call_meeting_booked'
    : outcome === 'connected' ? 'lead.call_connected'
    : outcome === 'follow_up' ? 'lead.call_follow_up'
    : outcome === 'converted' ? 'lead.stage_converted'
    : outcome === 'not_interested' ? 'lead.call_not_interested'
    : 'lead.call_logged';
  await logEvent({
    eventType: engagementEventType,
    leadId,
    source: 'sales',
    status: 'success',
    payload: { outcome, duration_seconds: durationSeconds, via: 'client_portal' }
  });

  return NextResponse.json({ ok: true, callLogId: result.insertId, outcome, durationSeconds, notes });
}
