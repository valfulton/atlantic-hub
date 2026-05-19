/**
 * POST /api/admin/av/outreach/messages/[id]/reject
 *
 * Mark a draft as rejected with an optional reason. Reason is shown back
 * to the operator in the message history.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { rejectDraft } from '@/lib/email/send_pipeline';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/messages/[id]/reject',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let body: { reason?: string } = {};
  try {
    body = (await req.json()) as { reason?: string };
  } catch {
    // empty body is fine
  }

  const result = await rejectDraft({
    messageId: id,
    rejecterUserId: guard.actor.userId,
    reason: body.reason ?? null
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
