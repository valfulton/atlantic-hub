/**
 * POST /api/admin/av/clients/[client_id]/intelligence/activate-pack  (val 2026-06-06)
 *
 * The 🚀 one-tap "set up this client's intelligence engine" endpoint. Backs
 * the starter-pack button at the top of PublicIntelPanel.
 *
 * Body: { packId: VerticalPackId }
 *
 * Flow:
 *   1. seed signal weights from the pack
 *   2. provision + enable each recommendedAdapter with a sane default config
 *   3. run each runnable adapter (lookup-only adapters get provisioned but skipped)
 *   4. trigger distress rescore
 *
 * Returns a structured report the UI strips into "Provisioned CA SOS ✓ ·
 * Ran PACER (3 dockets) ✓ · Ran CourtListener (12 records) ✓ · Rescored
 * (18 entities)". Owner / staff only. Cap 90s — long-tail sweeps offload.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { activatePackForClient } from '@/lib/public_intel/activate_pack';
import type { VerticalPackId } from '@/lib/public_intel/vertical_packs';
import { logEvent } from '@/lib/events/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/intelligence/activate-pack:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: { packId?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { /* empty fine */ }
  const packId = typeof body.packId === 'string' ? (body.packId as VerticalPackId) : null;
  if (!packId) {
    return NextResponse.json({ error: 'packId required' }, { status: 400 });
  }

  try {
    const report = await activatePackForClient(clientId, packId);
    void logEvent({
      eventType: 'intelligence.pack_activated',
      source: 'operator_action',
      status: report.ok ? 'success' : 'failure',
      payload: {
        client_id: clientId,
        pack_id: packId,
        weights_seeded: report.weightsSeeded,
        adapters_ran: report.adapterReports.filter((r) => r.status === 'ran').length,
        adapters_errored: report.adapterReports.filter((r) => r.status === 'errored').length,
        entities_scored: report.rescored?.entitiesScored ?? null,
        elapsed_ms: report.elapsedMs,
        actor_id: guard.actor.userId
      }
    });
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'activation failed', detail: (err as Error).message.slice(0, 280) },
      { status: 500 }
    );
  }
}
