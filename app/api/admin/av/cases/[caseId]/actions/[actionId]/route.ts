/**
 * PATCH /api/admin/av/cases/[caseId]/actions/[actionId]  (val 2026-06-11, Phase 2)
 *
 * Update an action item. Status changes most common; also title/detail/priority/due.
 *
 * Body (all optional, at least one required):
 *   {
 *     status?: 'open' | 'in_progress' | 'done' | 'blocked',
 *     priority?: 'low' | 'normal' | 'high' | 'urgent',
 *     title?: string,
 *     detail?: string,
 *     dueDate?: 'YYYY-MM-DD' | null,
 *     assignedToUserId?: number | null
 *   }
 *
 * Status='done' also sets completed_at. Operator-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { updateActionItem, type ActionStatus, type ActionPriority } from '@/lib/case/case_store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { caseId: string; actionId: string };
}

const STATUS_OK: ActionStatus[] = ['open', 'in_progress', 'done', 'blocked'];
const PRIORITY_OK: ActionPriority[] = ['low', 'normal', 'high', 'urgent'];

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req);
  if (!guard.ok) return guard.response;

  const actionId = parseInt(ctx.params.actionId, 10);
  if (!Number.isInteger(actionId) || actionId <= 0) {
    return NextResponse.json({ ok: false, error: 'bad action id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'body must be json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'body required' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const patch: Parameters<typeof updateActionItem>[1] = {};

  if (typeof b.title === 'string' && b.title.trim()) {
    patch.title = b.title.trim();
  }
  if (typeof b.detail === 'string') {
    patch.detail = b.detail;
  } else if (b.detail === null) {
    patch.detail = null;
  }
  if (typeof b.status === 'string' && (STATUS_OK as string[]).includes(b.status)) {
    patch.status = b.status as ActionStatus;
  }
  if (typeof b.priority === 'string' && (PRIORITY_OK as string[]).includes(b.priority)) {
    patch.priority = b.priority as ActionPriority;
  }
  if (b.assignedToUserId === null) {
    patch.assignedToUserId = null;
  } else if (typeof b.assignedToUserId === 'number' && Number.isInteger(b.assignedToUserId)) {
    patch.assignedToUserId = b.assignedToUserId;
  }
  if (typeof b.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(b.dueDate)) {
    patch.dueDate = b.dueDate;
  } else if (b.dueDate === null) {
    patch.dueDate = null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'no valid fields to update' }, { status: 400 });
  }

  const ok = await updateActionItem(actionId, patch);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'update failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
