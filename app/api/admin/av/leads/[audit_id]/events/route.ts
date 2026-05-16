/**
 * GET /api/admin/av/leads/[audit_id]/events
 *
 * Returns the lead_events timeline for one lead — created, stage_changed,
 * note_added, ai_scored, tag_added, archived, etc. Newest first.
 *
 * Read-only. Writes happen as side-effects of other endpoints (POST notes,
 * PATCH lead, etc.) inside the same DB transaction as the underlying change.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EventRow extends RowDataPacket {
  lead_event_id: number;
  event_type: string;
  event_payload: string | object | null;
  actor_user_id: number | null;
  actor_role: string | null;
  occurred_at: string;
}

function safeParse(val: string | object | null): object | null {
  if (val === null) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { audit_id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/events',
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
    const db = getAvDb();
    const [leadRows] = await db.execute<RowDataPacket[]>(
      'SELECT id FROM leads WHERE audit_id = ? LIMIT 1',
      [params.audit_id]
    );
    if (leadRows.length === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const leadId = (leadRows[0] as { id: number }).id;

    const [rows] = await db.execute<EventRow[]>(
      `SELECT lead_event_id, event_type, event_payload, actor_user_id, actor_role, occurred_at
         FROM lead_events
        WHERE lead_id = ?
        ORDER BY occurred_at DESC
        LIMIT 200`,
      [leadId]
    );

    const events = rows.map((r) => ({
      eventId: r.lead_event_id,
      eventType: r.event_type,
      eventPayload: safeParse(r.event_payload),
      actorUserId: r.actor_user_id,
      actorRole: r.actor_role,
      occurredAt: r.occurred_at
    }));

    return NextResponse.json({ events });
  } catch (err) {
    console.error('[av:events:get]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
