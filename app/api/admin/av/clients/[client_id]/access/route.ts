/**
 * POST /api/admin/av/clients/[client_id]/access
 *
 * Operator control of a client's access + tier. Body (any subset):
 *   { tier?: 'audit_only'|'sprint'|'momentum'|'scale',
 *     enabled?: boolean,
 *     grantDays?: number,          // grant/extend a trial window from today
 *     accessUntil?: 'YYYY-MM-DD'|null }
 *
 * Owner + staff only (operator). Returns the resulting access state.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { setClientAccess } from '@/lib/av/client_access';
import type { ClientTier } from '@/lib/client-portal/tiers';

export const runtime = 'nodejs';

const TIERS: ClientTier[] = ['audit_only', 'sprint', 'momentum', 'scale'];

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/clients/access:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) return NextResponse.json({ error: 'invalid client id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  try {
    const state = await setClientAccess(clientId, {
      tier: typeof body.tier === 'string' && TIERS.includes(body.tier as ClientTier) ? (body.tier as ClientTier) : undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      grantDays: typeof body.grantDays === 'number' ? body.grantDays : undefined,
      accessUntil: body.accessUntil === null ? null : (typeof body.accessUntil === 'string' ? body.accessUntil : undefined)
    });
    return NextResponse.json({ ok: true, state });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
