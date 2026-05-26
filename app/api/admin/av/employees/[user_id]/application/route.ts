/**
 * POST /api/admin/av/employees/[user_id]/application
 *
 * Save an employee's onboarding application. Owner + staff (an employee can save
 * their own; the operator can fill/prefill on anyone's behalf). Non-sensitive
 * fields only — SSN/bank/IDs belong in document uploads, never here.
 *
 * Body: { title?, phone?, location?, startDate?, compBasis?, emergencyContact?, payload? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { saveEmployeeApplication } from '@/lib/employees/store';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { user_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/employees/application:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const userId = Number.parseInt(params.user_id, 10);
  if (!Number.isFinite(userId) || userId <= 0) return NextResponse.json({ error: 'invalid user id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const str = (k: string) => (typeof body[k] === 'string' && (body[k] as string).trim() ? (body[k] as string).trim() : null);
  const payload =
    body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : {};

  try {
    await saveEmployeeApplication(userId, {
      title: str('title'),
      phone: str('phone'),
      location: str('location'),
      startDate: str('startDate'),
      compBasis: str('compBasis'),
      emergencyContact: str('emergencyContact'),
      payload
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
