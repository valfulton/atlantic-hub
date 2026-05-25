/**
 * POST /api/admin/social/outbox
 *
 * Compose + schedule a social post straight onto the Campaign Timeline. Creates a
 * social_outbox row (status 'scheduled' when a time is given, else 'draft') so it
 * appears on the calendar immediately. The publish-due cron picks it up when its
 * time arrives (or the operator publishes it from the timeline). Owner + staff.
 *
 * Body: { connectionId, body, scheduledFor?, mediaUrl?, mediaType?, leadId? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** 'YYYY-MM-DDTHH:MM' (datetime-local) or ISO -> MySQL DATETIME 'YYYY-MM-DD HH:MM:SS'. */
function toMysqlDatetime(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/social/outbox:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: { connectionId?: unknown; body?: unknown; scheduledFor?: unknown; mediaUrl?: unknown; mediaType?: unknown; leadId?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const connectionId = Number.parseInt(String(body.connectionId ?? ''), 10);
  if (!Number.isFinite(connectionId) || connectionId <= 0) {
    return NextResponse.json({ error: 'pick a channel to post from' }, { status: 400 });
  }
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return NextResponse.json({ error: 'write something to post' }, { status: 400 });

  const scheduledFor = toMysqlDatetime(body.scheduledFor);
  const mediaUrl = typeof body.mediaUrl === 'string' && body.mediaUrl.trim() ? body.mediaUrl.trim() : null;
  const mediaType = mediaUrl ? (body.mediaType === 'video' ? 'video' : 'image') : 'none';
  const leadId = Number.isFinite(Number(body.leadId)) && Number(body.leadId) > 0 ? Number(body.leadId) : null;

  try {
    const db = getAvDb();
    // Resolve the connection -> its tenant, and confirm it's usable.
    const [conns] = await db.execute<(RowDataPacket & { id: number; tenant_id: string; status: string })[]>(
      `SELECT id, tenant_id, status FROM social_connections WHERE id = ? LIMIT 1`,
      [connectionId]
    );
    const conn = conns[0];
    if (!conn) return NextResponse.json({ error: 'channel not found' }, { status: 404 });
    if (conn.status !== 'active') return NextResponse.json({ error: 'that channel is not active' }, { status: 409 });

    const status = scheduledFor ? 'scheduled' : 'draft';
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO social_outbox
         (tenant_id, connection_id, lead_id, body_text, media_url, media_type, status, scheduled_for, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [conn.tenant_id, connectionId, leadId, text, mediaUrl, mediaType, status, scheduledFor, guard.actor.userId]
    );
    return NextResponse.json({ ok: true, outboxId: res.insertId, status, scheduledFor });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
