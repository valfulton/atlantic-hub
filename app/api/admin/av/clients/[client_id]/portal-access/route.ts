/**
 * POST /api/admin/av/clients/[client_id]/portal-access   { fullAccess: boolean }
 *
 * Operator override of the intake gate. By default a client gets NO hub access
 * until they submit their intake. This lets val GRANT full portal access to a
 * client anytime (bypassing the intake requirement) — her power, no permission
 * needed — and revoke it back to "intake required". Stored as `portal_full_access`
 * on the client's brief payload; the gate (lib/client/intake_gate.ts) honors it.
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getBriefPayload, saveBriefPayload, type BriefPayload } from '@/lib/client/brief_store';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/clients/portal-access:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) return NextResponse.json({ error: 'invalid client id' }, { status: 400 });

  let body: { fullAccess?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const fullAccess = body.fullAccess === true;

  try {
    // Read-merge-write so we never clobber the brief/intake answers.
    const current = ((await getBriefPayload('av', clientId)) ?? {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...current, portal_full_access: fullAccess };
    const ok = await saveBriefPayload('av', clientId, merged as BriefPayload, { source: 'operator', changedBy: 'operator' });
    if (!ok) return NextResponse.json({ error: 'save failed' }, { status: 500 });
    return NextResponse.json({ ok: true, fullAccess });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
