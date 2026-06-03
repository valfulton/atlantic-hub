/**
 * POST /api/admin/av/clients/[client_id]/distress/rescore  (#372)
 *
 * Body: { lookbackDays?: number, seedDefaults?: boolean }
 *
 * Recomputes distress scores for this client. If seedDefaults is true and the
 * client has no weights configured, the advisor's 7 CBB defaults are seeded
 * first. (CBB defaults are reasonable starting weights for collections/legal
 * service clients; specific verticals should tune from there.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import {
  rescoreClient,
  seedDefaultsForClient,
  CBB_DEFAULT_WEIGHTS
} from '@/lib/public_intel/distress_engine';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/distress/rescore:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: { lookbackDays?: unknown; seedDefaults?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { /* empty fine */ }
  const lookbackDays = typeof body.lookbackDays === 'number' && body.lookbackDays > 0 ? body.lookbackDays : 90;
  const wantSeed = body.seedDefaults === true;

  let seeded = 0;
  if (wantSeed) seeded = await seedDefaultsForClient(clientId, CBB_DEFAULT_WEIGHTS);

  const result = await rescoreClient(clientId, lookbackDays);
  return NextResponse.json({ seeded, ...result });
}
