/**
 * POST /api/admin/av/leads/[audit_id]/assign
 *
 * Assign or unassign a lead to a sales rep, OR flag the lead for the
 * owner's warm-email queue. One unified endpoint so the UI can call
 * either action.
 *
 * Body shapes:
 *   { assignToUserId: number | null }       Assign or unassign.
 *   { handToOwner: true | false }            Set or clear handed_to_owner_at.
 *
 * Both fields can appear in the same request and are processed
 * together. Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/assign:POST',
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

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
    [params.audit_id]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  }
  const leadId = rows[0].id;

  const updates: string[] = [];
  const values: unknown[] = [];
  const eventPayload: Record<string, unknown> = {};

  // Assignment
  if ('assignToUserId' in payload) {
    const v = payload.assignToUserId;
    if (v === null) {
      updates.push('assigned_to_user_id = NULL');
      eventPayload.assignToUserId = null;
    } else if (typeof v === 'number' && Number.isInteger(v) && v > 0) {
      updates.push('assigned_to_user_id = ?');
      values.push(v);
      eventPayload.assignToUserId = v;
    } else {
      return NextResponse.json({ error: 'assignToUserId must be a positive integer or null' }, { status: 400 });
    }
  }

  // Hand-to-owner flag
  if ('handToOwner' in payload) {
    const v = payload.handToOwner;
    if (v === true) {
      updates.push('handed_to_owner_at = NOW()');
      eventPayload.handToOwner = true;
    } else if (v === false) {
      updates.push('handed_to_owner_at = NULL');
      eventPayload.handToOwner = false;
    } else {
      return NextResponse.json({ error: 'handToOwner must be boolean' }, { status: 400 });
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'no recognised fields to update' }, { status: 400 });
  }

  updates.push('last_activity_at = NOW()');

  await db.execute<ResultSetHeader>(
    `UPDATE leads SET ${updates.join(', ')} WHERE id = ?`,
    [...values, leadId]
  );

  await logEvent({
    eventType: 'handToOwner' in payload && payload.handToOwner === true
      ? 'lead.handed_to_owner'
      : 'lead.assignment_changed',
    leadId,
    userId: guard.actor.userId,
    source: 'sales',
    status: 'success',
    payload: eventPayload
  });

  return NextResponse.json({ ok: true, leadId, updates: eventPayload });
}
