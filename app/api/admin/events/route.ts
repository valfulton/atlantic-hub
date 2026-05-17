/**
 * GET /api/admin/events
 *
 * Returns the most recent rows from shhdbite_AV.system_events with
 * optional filters. Owner + staff only -- client_user is forbidden because
 * this is a cross-tenant observability surface.
 *
 * Query params (all optional):
 *   eventType   -- exact event_type match (e.g. 'lead.created')
 *   status      -- 'success' | 'failure' | 'partial' | 'pending'
 *   source      -- exact source match (e.g. 'apollo')
 *   leadId      -- filter to one lead
 *   limit       -- 1..500 (default 200)
 *
 * Response: { events: SystemEvent[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface EventRow extends RowDataPacket {
  id: number;
  event_type: string;
  organization_id: number | null;
  lead_id: number | null;
  user_id: number | null;
  source: string | null;
  payload: string | object | null;
  status: 'success' | 'failure' | 'partial' | 'pending';
  execution_time_ms: number | null;
  error_message: string | null;
  created_at: string;
}

const VALID_STATUS = new Set(['success', 'failure', 'partial', 'pending']);

function safeParse(val: string | object | null): unknown {
  if (val === null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/events',
    tenantId: 'platform'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const eventType = url.searchParams.get('eventType');
  const status = url.searchParams.get('status');
  const source = url.searchParams.get('source');
  const leadIdParam = url.searchParams.get('leadId');
  const limitParam = url.searchParams.get('limit');

  const where: string[] = [];
  const params: unknown[] = [];

  if (eventType) {
    where.push('event_type = ?');
    params.push(eventType);
  }
  if (status && VALID_STATUS.has(status)) {
    where.push('status = ?');
    params.push(status);
  }
  if (source) {
    where.push('source = ?');
    params.push(source);
  }
  if (leadIdParam) {
    const n = parseInt(leadIdParam, 10);
    if (Number.isFinite(n) && n > 0) {
      where.push('lead_id = ?');
      params.push(n);
    }
  }

  // mysql2 + HostGator MariaDB throws ER_WRONG_ARGUMENTS on prepared LIMIT ?.
  // Validate to integer 1..500 then concat -- safe because we never accept
  // raw string.
  const limit = Math.min(
    500,
    Math.max(1, Number.isFinite(parseInt(limitParam ?? '', 10)) ? parseInt(limitParam ?? '200', 10) : 200)
  );

  try {
    const db = getAvDb();
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await db.query<EventRow[]>(
      `SELECT id, event_type, organization_id, lead_id, user_id, source, payload,
              status, execution_time_ms, error_message, created_at
         FROM system_events
         ${whereSql}
         ORDER BY id DESC
         LIMIT ${limit}`,
      params
    );

    return NextResponse.json({
      events: rows.map((r) => ({
        id: r.id,
        eventType: r.event_type,
        organizationId: r.organization_id,
        leadId: r.lead_id,
        userId: r.user_id,
        source: r.source,
        payload: safeParse(r.payload as string | object | null),
        status: r.status,
        executionTimeMs: r.execution_time_ms,
        errorMessage: r.error_message,
        createdAt: r.created_at
      })),
      filters: { eventType, status, source, leadId: leadIdParam ?? null, limit }
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name, message: (err as Error).message.slice(0, 300) },
      { status: 500 }
    );
  }
}
