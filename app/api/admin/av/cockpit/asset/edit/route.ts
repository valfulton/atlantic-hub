/**
 * POST /api/admin/av/cockpit/asset/edit  (#570, Tier 1.3)
 *
 * Save edits to a cockpit_approvals row. Supports two shapes:
 *   1. EXISTING row: { clientId, approvalId, title, body, scheduledAt? }
 *      → UPDATE cockpit_approvals
 *   2. INLINE row (in-memory cockpit card not yet persisted):
 *      { clientId, approval: {kind, title, source, angle}, body, scheduledAt? }
 *      → CREATE + return new approval_id
 *
 * Either way, returns the saved row so the modal can refresh.
 *
 * Edits keep status='pending' (don't auto-approve via editing). Green Light
 * is the separate action that flips status + dispatches.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import {
  createApproval,
  updateApprovalContent,
  type ApprovalKind
} from '@/lib/av/cockpit_approvals';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface InlineApproval {
  kind: ApprovalKind;
  title: string;
  source?: string | null;
  angle?: string | null;
}

interface Body {
  clientId?: number;
  approvalId?: number;
  approval?: InlineApproval;
  title?: string;
  body?: string | null;
  scheduledAt?: string | null;
}

function isValidKind(v: unknown): v is ApprovalKind {
  return v === 'commercial' || v === 'press_release' || v === 'op_ed' || v === 'social';
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/cockpit/asset/edit:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let payload: Body;
  try {
    payload = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const { clientId, title, body, scheduledAt } = payload;
  if (!Number.isFinite(clientId)) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  }

  let approvalId = payload.approvalId ?? 0;

  // Inline path — create the row first so we always have a persisted id.
  if (!approvalId && payload.approval && isValidKind(payload.approval.kind)) {
    approvalId = await createApproval({
      clientId: clientId as number,
      kind: payload.approval.kind,
      title: title?.trim() || payload.approval.title,
      body: body ?? null,
      source: payload.approval.source ?? null,
      angle: payload.approval.angle ?? null,
      scheduledAt: scheduledAt ?? null,
      status: 'pending'
    });
    if (!approvalId) {
      return NextResponse.json({ error: 'could not persist approval' }, { status: 500 });
    }
  }

  if (!approvalId) {
    return NextResponse.json({ error: 'approvalId or approval payload required' }, { status: 400 });
  }

  // For existing rows, apply the updates. For brand-new inline rows, the
  // createApproval call above already wrote title+body+scheduledAt — skip.
  if (!payload.approval) {
    const ok = await updateApprovalContent(approvalId, {
      title: title,
      body: body,
      scheduledAt: scheduledAt
    });
    if (!ok) {
      return NextResponse.json({ error: 'could not update' }, { status: 500 });
    }
  }

  // Read back the saved row so the modal can show what landed.
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & {
      approval_id: number; approval_kind: ApprovalKind; title: string; body_text: string | null;
      source: string | null; angle: string | null; status: string; scheduled_at: string | null;
      updated_at: string;
    })[]>(
      `SELECT approval_id, approval_kind, title, body_text, source, angle, status, scheduled_at, updated_at
         FROM cockpit_approvals WHERE approval_id = ?`,
      [approvalId]
    );
    const r = rows[0];
    if (!r) return NextResponse.json({ ok: true, approvalId, saved: null });
    return NextResponse.json({
      ok: true,
      approvalId,
      saved: {
        id: r.approval_id,
        kind: r.approval_kind,
        title: r.title,
        body: r.body_text,
        source: r.source,
        angle: r.angle,
        status: r.status,
        scheduledAt: r.scheduled_at,
        updatedAt: r.updated_at
      }
    });
  } catch (err) {
    console.error('[cockpit:asset:edit]', (err as Error).message);
    return NextResponse.json({ ok: true, approvalId, saved: null, note: 'saved but readback failed' });
  }
}
