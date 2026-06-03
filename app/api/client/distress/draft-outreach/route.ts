/**
 * POST /api/client/distress/draft-outreach  (#385, val 2026-06-03)
 *
 * Client-side companion to /api/admin/av/clients/[id]/distress/draft-outreach.
 * Scoped to the active brand.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';
import { draftDistressOutreach } from '@/lib/ai/distress_outreach_drafter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const user = await findClientUserById(actor.clientUserId);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);
  if (!clientId) return NextResponse.json({ error: 'no active brand' }, { status: 400 });

  let body: { entityKey?: unknown; entityLabel?: unknown; score?: unknown; signalKinds?: unknown; regionCode?: unknown } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const entityKey = typeof body.entityKey === 'string' ? body.entityKey : null;
  if (!entityKey) return NextResponse.json({ error: 'entityKey required' }, { status: 400 });

  try {
    const draft = await draftDistressOutreach({
      clientId,
      entityKey,
      entityLabel: typeof body.entityLabel === 'string' ? body.entityLabel : null,
      score: typeof body.score === 'number' ? body.score : 0,
      signalKinds: Array.isArray(body.signalKinds) ? body.signalKinds.filter((s): s is string => typeof s === 'string') : [],
      regionCode: typeof body.regionCode === 'string' ? body.regionCode : null
    });
    return NextResponse.json({
      ok: true,
      draft: {
        subject: draft.subject,
        body: draft.body,
        attribution: draft.attribution ? { humanLine: draft.attribution.humanLine } : null,
        costMicrocents: draft.costMicrocents
      }
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
