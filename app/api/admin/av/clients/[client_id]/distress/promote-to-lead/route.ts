/**
 * POST /api/admin/av/clients/[client_id]/distress/promote-to-lead  (#387, val 2026-06-03)
 *
 * Body: { entityKey, entityLabel?, score, signalKinds, regionCode? }
 *
 * Promotes a watchlist entity into the leads pipeline for this client.
 * Returns the new lead's id + auditId so the UI can link straight to the
 * lead detail page.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { promoteEntityToLead } from '@/lib/public_intel/promote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/distress/promote-to-lead:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: { entityKey?: unknown; entityLabel?: unknown; score?: unknown; signalKinds?: unknown; regionCode?: unknown } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const entityKey = typeof body.entityKey === 'string' ? body.entityKey : null;
  if (!entityKey) return NextResponse.json({ error: 'entityKey required' }, { status: 400 });
  const entityLabel = typeof body.entityLabel === 'string' ? body.entityLabel : null;
  const score = typeof body.score === 'number' ? body.score : 0;
  const signalKinds = Array.isArray(body.signalKinds) ? body.signalKinds.filter((s): s is string => typeof s === 'string') : [];
  const regionCode = typeof body.regionCode === 'string' ? body.regionCode : null;

  try {
    const result = await promoteEntityToLead({
      clientId,
      entityKey,
      entityLabel,
      regionCode,
      score,
      signalKinds,
      actorKind: 'operator',
      actorId: guard.actor.userId
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
