/**
 * /api/admin/av/leads/[audit_id]/calls
 *
 * GET   List calls logged for this lead. Most recent first. Capped 100.
 * POST  Log a new call. Body: { outcome, durationSeconds?, notes? }
 *
 * Owner + staff only. Each POST appends to call_log AND fires a
 * system_event 'lead.call_logged' so the engagement scorer can see it
 * and the events page surfaces the activity.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
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
  lead_id: number;
  user_id: number | null;
  outcome: string;
  duration_seconds: number | null;
  notes: string | null;
  called_at: string;
}

async function leadIdFromAuditId(auditId: string): Promise<number | null> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
    [auditId]
  );
  return rows.length === 0 ? null : rows[0].id;
}

export async function GET(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/calls',
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

  const leadId = await leadIdFromAuditId(params.audit_id);
  if (leadId === null) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

  const db = getAvDb();
  const [rows] = await db.execute<CallRow[]>(
    `SELECT call_log_id, lead_id, user_id, outcome, duration_seconds, notes, called_at
       FROM call_log
      WHERE lead_id = ?
      ORDER BY called_at DESC, call_log_id DESC
      LIMIT 100`,
    [leadId]
  );

  return NextResponse.json({
    calls: rows.map((r) => ({
      callLogId: r.call_log_id,
      leadId: r.lead_id,
      userId: r.user_id,
      outcome: r.outcome,
      durationSeconds: r.duration_seconds,
      notes: r.notes,
      calledAt: r.called_at
    }))
  });
}

export async function POST(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/calls:POST',
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

  const leadId = await leadIdFromAuditId(params.audit_id);
  if (leadId === null) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const outcome = typeof payload.outcome === 'string' ? payload.outcome : '';
  if (!VALID_OUTCOMES.has(outcome)) {
    return NextResponse.json({ error: 'invalid outcome', validOutcomes: Array.from(VALID_OUTCOMES) }, { status: 400 });
  }
  const durationSeconds =
    typeof payload.durationSeconds === 'number' && Number.isFinite(payload.durationSeconds) && payload.durationSeconds >= 0
      ? Math.min(7200, Math.floor(payload.durationSeconds))
      : null;
  const notes =
    typeof payload.notes === 'string' ? payload.notes.slice(0, 4000) : null;

  const db = getAvDb();
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO call_log (lead_id, user_id, outcome, duration_seconds, notes)
     VALUES (?, ?, ?, ?, ?)`,
    [leadId, guard.actor.userId, outcome, durationSeconds, notes]
  );

  // Bump last_activity_at so the leads list re-ranks this lead toward the top.
  await db.execute<ResultSetHeader>(
    `UPDATE leads SET last_activity_at = NOW() WHERE id = ?`,
    [leadId]
  );

  // Fire a system_event so the engagement scorer can react + the events page surfaces.
  // We map outcome to an engagement weight via the event_type: connected gets a bigger
  // bump than voicemail.
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
    userId: guard.actor.userId,
    source: 'sales',
    status: 'success',
    payload: { outcome, duration_seconds: durationSeconds }
  });

  return NextResponse.json({
    ok: true,
    callLogId: result.insertId,
    leadId,
    outcome,
    durationSeconds,
    notes
  });
}
