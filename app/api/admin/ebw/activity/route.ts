import { NextRequest, NextResponse } from 'next/server';
import { getEbwDb } from '@/lib/db/ebw';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

const VALID_TYPES = new Set(['cold_call', 'cold_email', 'dm', 'meeting', 'demo', 'follow_up', 'proposal_sent', 'contract_sent', 'other']);
const VALID_OUTCOMES = new Set(['no_answer', 'left_voicemail', 'interested', 'not_interested', 'meeting_scheduled', 'closed', 'other']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ActivityRow extends RowDataPacket {
  activity_id: number;
  occurred_on: string;
  activity_type: string;
  prospect_audit_id: string | null;
  prospect_label: string | null;
  outcome: string | null;
  notes: string | null;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/ebw/activity', tenantId: 'ebw' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_ebw_enabled'))) return NextResponse.json({ error: 'ebw tab disabled' }, { status: 403 });

  try {
    const db = getEbwDb();
    const [rows] = await db.execute<ActivityRow[]>(
      `SELECT activity_id, occurred_on, activity_type, prospect_audit_id, prospect_label, outcome, notes, created_at
         FROM marketing_activity ORDER BY occurred_on DESC, activity_id DESC LIMIT 500`
    );
    return NextResponse.json({
      activity: rows.map((r) => ({
        activityId: r.activity_id,
        occurredOn: r.occurred_on,
        activityType: r.activity_type,
        prospectAuditId: r.prospect_audit_id,
        prospectLabel: r.prospect_label,
        outcome: r.outcome,
        notes: r.notes,
        createdAt: r.created_at
      }))
    });
  } catch (err) {
    console.error('[ebw:activity:get]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/ebw/activity:POST', tenantId: 'ebw' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_ebw_enabled'))) return NextResponse.json({ error: 'ebw tab disabled' }, { status: 403 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const occurredOn = typeof body.occurredOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.occurredOn) ? body.occurredOn : null;
  if (!occurredOn) return NextResponse.json({ error: 'occurredOn (YYYY-MM-DD) required' }, { status: 400 });
  const activityType = typeof body.activityType === 'string' && VALID_TYPES.has(body.activityType) ? body.activityType : null;
  if (!activityType) return NextResponse.json({ error: 'activityType required' }, { status: 400 });
  const outcome = typeof body.outcome === 'string' && VALID_OUTCOMES.has(body.outcome) ? body.outcome : null;
  const auditId = typeof body.prospectAuditId === 'string' && UUID_RE.test(body.prospectAuditId) ? body.prospectAuditId : null;
  const label = typeof body.prospectLabel === 'string' && body.prospectLabel.trim() ? body.prospectLabel.trim().slice(0, 255) : null;
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 8000) : null;

  try {
    const db = getEbwDb();
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO marketing_activity (occurred_on, activity_type, prospect_audit_id, prospect_label, outcome, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [occurredOn, activityType, auditId, label, outcome, notes]
    );
    return NextResponse.json({ activityId: result.insertId }, { status: 201 });
  } catch (err) {
    console.error('[ebw:activity:post]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
