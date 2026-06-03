/**
 * POST /api/admin/av/clients/[client_id]/distress/draft-outreach  (#382, val 2026-06-03)
 *
 * Body: { entityKey, entityLabel?, score, signalKinds, regionCode? }
 *
 * Drafts a cold-outreach opener for one distressed entity using the
 * cascade-attribution layer + the client's offer + voice. Returns subject +
 * body + the attribution chain (so val can show "this is how we got there"
 * during a demo).
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { draftDistressOutreach } from '@/lib/ai/distress_outreach_drafter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface Body {
  entityKey?: unknown;
  entityLabel?: unknown;
  score?: unknown;
  signalKinds?: unknown;
  regionCode?: unknown;
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/distress/draft-outreach:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: Body = {};
  try { body = (await req.json()) as Body; } catch { /* empty body */ }
  const entityKey = typeof body.entityKey === 'string' ? body.entityKey : null;
  if (!entityKey) return NextResponse.json({ error: 'entityKey required' }, { status: 400 });
  const entityLabel = typeof body.entityLabel === 'string' ? body.entityLabel : null;
  const score = typeof body.score === 'number' ? body.score : 0;
  const signalKinds = Array.isArray(body.signalKinds)
    ? body.signalKinds.filter((s): s is string => typeof s === 'string')
    : [];
  const regionCode = typeof body.regionCode === 'string' ? body.regionCode : null;

  try {
    const draft = await draftDistressOutreach({
      clientId,
      entityKey,
      entityLabel,
      score,
      signalKinds,
      regionCode
    });
    return NextResponse.json({
      ok: true,
      draft: {
        subject: draft.subject,
        body: draft.body,
        attribution: draft.attribution
          ? {
              humanLine: draft.attribution.humanLine,
              trail: draft.attribution.trail.map((s) => ({
                sourceKind: s.sourceKind,
                recipeId: s.recipeId,
                triggerSummary: s.triggerSummary,
                triggerFetchedAt: s.triggerFetchedAt.toISOString(),
                triggerEntityKey: s.triggerEntityKey
              }))
            }
          : null,
        model: draft.model,
        tokensUsed: draft.tokensUsed,
        costMicrocents: draft.costMicrocents
      }
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
