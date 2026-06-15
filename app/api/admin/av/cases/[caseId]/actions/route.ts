/**
 * POST /api/admin/av/cases/[caseId]/actions  (val 2026-06-14, #632)
 *
 * Create a new action item on a case. Operator-only.
 *
 * Body:
 *   {
 *     title: string                                   (required, trimmed)
 *     detail?: string | null
 *     priority?: 'low' | 'normal' | 'high' | 'urgent' (default 'normal')
 *     dueDate?: 'YYYY-MM-DD' | null
 *     assignedToUserId?: number | null
 *   }
 *
 * Pairs with PATCH (./[actionId]/route.ts) and DELETE (./[actionId]/route.ts).
 * Together they kill the case-data SQL workflow val was using to rewrite
 * Options A–E on the Johnson trust matter.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { addActionItem, type ActionPriority } from '@/lib/case/case_store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { caseId: string };
}

const PRIORITY_OK: ActionPriority[] = ['low', 'normal', 'high', 'urgent'];

export async function POST(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_action:create:${ctx.params.caseId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  const caseId = parseInt(ctx.params.caseId, 10);
  if (!Number.isInteger(caseId) || caseId <= 0) {
    return NextResponse.json({ ok: false, error: 'bad case id' }, { status: 400 });
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

  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title) {
    return NextResponse.json({ ok: false, error: 'title required' }, { status: 400 });
  }

  const priority: ActionPriority =
    typeof b.priority === 'string' && (PRIORITY_OK as string[]).includes(b.priority)
      ? (b.priority as ActionPriority)
      : 'normal';

  const detail = typeof b.detail === 'string' ? b.detail : null;
  const dueDate =
    typeof b.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(b.dueDate)
      ? b.dueDate
      : null;
  const assignedToUserId =
    typeof b.assignedToUserId === 'number' && Number.isInteger(b.assignedToUserId)
      ? b.assignedToUserId
      : null;

  const actionId = await addActionItem({
    caseId,
    title,
    detail,
    priority,
    dueDate,
    assignedToUserId
  });

  if (!actionId) {
    return NextResponse.json({ ok: false, error: 'create failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, actionId }, { status: 201 });
}
