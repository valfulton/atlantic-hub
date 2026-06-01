/**
 * POST /api/admin/av/clients/[client_id]/icp
 *
 * Operator-only. Saves a client's Ideal Customer Profile — who their discovery
 * should look for. Body fields (all optional): industries[], geographies[],
 * excludeGeographies[], excludedIndustries[], companySizeMin, companySizeMax,
 * description. Normalized via lib/client/icp.normalizeIcp, then upserted.
 *
 * The ICP drives client-scoped discovery (find-leads): industries become Apollo
 * keyword tags; excludedIndustries are post-filtered out (Apollo has no negative
 * keyword filter). Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { normalizeIcp, saveClientIcp, getClientIcpWithProvenance, operatorSaveProvenance } from '@/lib/client/icp';
import { maybeRescoreAfterIcpChange } from '@/lib/client/autopilot';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/clients/icp:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const icp = normalizeIcp(body);
  try {
    // Recompute provenance: items val keeps that the client originally authored
    // stay tagged 'client'; anything new she typed becomes 'operator'.
    const { provenance: priorProv } = await getClientIcpWithProvenance(clientId);
    const provenance = operatorSaveProvenance(icp, priorProv);
    await saveClientIcp(clientId, icp, guard.actor.userId ?? null, provenance);

    // (#314) Stale-reason fix: existing fit scores on this client's leads were
    // computed against the PREVIOUS ICP snapshot. Invalidate + bulk rescore
    // in fire-and-forget so val never sees "industry not in target industries"
    // for an industry she just added to the ICP.
    void maybeRescoreAfterIcpChange({ clientId });

    return NextResponse.json({ ok: true, icp });
  } catch (err) {
    return NextResponse.json({ error: 'save failed', errorClass: (err as Error).name }, { status: 500 });
  }
}
