/**
 * POST /api/admin/av/clients/[client_id]/cascades/run  (#374)
 *
 * Body: { lookbackDays?: number }
 *
 * Sweep recent public_intel_records for this client, fire every matching
 * cascade recipe, return a per-recipe breakdown. After this fires, the
 * Distress Watchlist usually has new entries — run /distress/rescore right
 * after to see them surface in the UI.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { runCascadesForClient } from '@/lib/public_intel/cascade';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/cascades/run:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }
  let body: { lookbackDays?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { /* empty fine */ }
  const lookbackDays = typeof body.lookbackDays === 'number' && body.lookbackDays > 0 ? body.lookbackDays : 7;
  const result = await runCascadesForClient(clientId, lookbackDays);
  return NextResponse.json({ ok: true, ...result });
}
