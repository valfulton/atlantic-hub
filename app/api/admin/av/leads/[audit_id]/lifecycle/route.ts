/**
 * POST /api/admin/av/leads/[audit_id]/lifecycle
 *
 * Move a lead through its lifecycle: new -> contacted -> qualified ->
 * converted, OR sideways to nurture / not_now / referred / case_study /
 * lost. Side effects (wake date, parked reason, status badges, history
 * events) are handled by lib/leads/lifecycle.ts.
 *
 * Body: { toStatus, wakeAtDate?, parkedReason? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import {
  isValidStatus,
  transitionLeadStatus,
  type LifecycleStatus
} from '@/lib/leads/lifecycle';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/lifecycle:POST',
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

  const toStatus = typeof payload.toStatus === 'string' ? payload.toStatus : '';
  if (!isValidStatus(toStatus)) {
    return NextResponse.json({ error: 'invalid toStatus' }, { status: 400 });
  }

  const wakeAtDate = typeof payload.wakeAtDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.wakeAtDate)
    ? payload.wakeAtDate
    : payload.wakeAtDate === null
    ? null
    : undefined;
  const parkedReason = typeof payload.parkedReason === 'string'
    ? payload.parkedReason.slice(0, 160)
    : null;

  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
    [params.audit_id]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  }

  const result = await transitionLeadStatus({
    leadId: rows[0].id,
    toStatus: toStatus as LifecycleStatus,
    wakeAtDate,
    parkedReason,
    actorUserId: guard.actor.userId
  });

  if (!result) {
    return NextResponse.json({ error: 'transition failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, leadId: rows[0].id, toStatus: result });
}
