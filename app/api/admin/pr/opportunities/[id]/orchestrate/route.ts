/**
 * POST /api/admin/pr/opportunities/[id]/orchestrate
 *
 * One-click campaign chain: draft the pitch -> (optional) generate a commercial
 * via the existing Grok engine -> queue a social_outbox post for the client's
 * connected account. Links the produced ids back onto the opportunity.
 *
 * Body: {
 *   leadId?: number,            // override matched client
 *   makeCommercial?: boolean,   // default false
 *   assetType?: 'image'|'video',// default 'image'
 *   scheduledFor?: string|null  // ISO datetime to schedule; null => draft
 * }
 *
 * HONEST: this QUEUES to the timeline (status draft/scheduled). It does not post
 * to the provider -- the social publisher is a separate, not-yet-built session.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import {
  orchestrateOpportunity,
  OrchestrateOpportunityNotFoundError
} from '@/lib/pr/orchestrate';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/pr/opportunities/[id]/orchestrate:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const opportunityId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(opportunityId) || opportunityId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // empty body ok
  }

  const assetType = body.assetType === 'video' ? 'video' : 'image';
  const makeCommercial = body.makeCommercial === true;
  const publishNow = body.publishNow === true;
  const leadId = typeof body.leadId === 'number' ? body.leadId : null;
  const scheduledFor = typeof body.scheduledFor === 'string' && body.scheduledFor ? body.scheduledFor : null;

  try {
    const result = await orchestrateOpportunity({
      opportunityId,
      leadId,
      makeCommercial,
      assetType,
      scheduledFor,
      publishNow,
      actorUserId: guard.actor.userId
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof OrchestrateOpportunityNotFoundError) {
      return NextResponse.json({ error: 'opportunity not found' }, { status: 404 });
    }
    console.error('[pr:orchestrate]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
