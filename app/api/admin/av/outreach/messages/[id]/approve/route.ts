/**
 * POST /api/admin/av/outreach/messages/[id]/approve
 *
 * Approve a draft and immediately dispatch the send through the mailbox
 * driver. The pipeline enforces per-mailbox / per-campaign / per-tier
 * daily caps and writes outreach_send_log + system_events.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { sendDraft } from '@/lib/email/send_pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/messages/[id]/approve',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  // Val is the operator -- tier='operator' bypasses the tier cap.
  // Per-mailbox + per-campaign caps still apply.
  const result = await sendDraft({
    messageId: id,
    approverUserId: guard.actor.userId,
    tier: 'operator'
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
