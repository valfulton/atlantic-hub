/**
 * POST /api/admin/av/employees/[user_id]/contract   { signedName }
 *
 * Records a signed contract: typed name + timestamp on the employee's profile,
 * and advances status to active. Owner + staff (an employee signs their own).
 * The contract document itself is uploaded via the documents endpoint.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { signEmployeeContract } from '@/lib/employees/store';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { user_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/employees/contract:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const userId = Number.parseInt(params.user_id, 10);
  if (!Number.isFinite(userId) || userId <= 0) return NextResponse.json({ error: 'invalid user id' }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }

  const signedName = typeof body.signedName === 'string' ? body.signedName.trim() : '';
  if (signedName.length < 2) return NextResponse.json({ error: 'type your full name to sign' }, { status: 400 });
  const contractDocUrl = typeof body.contractDocUrl === 'string' && body.contractDocUrl.trim() ? body.contractDocUrl.trim() : null;

  try {
    await signEmployeeContract(userId, signedName, contractDocUrl);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
