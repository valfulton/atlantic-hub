/**
 * POST /api/admin/av/employees/create
 *
 * Operator creates an employee (sales rep) account: a staff admin_users row +
 * employee_profiles row + a set-password invite link the employee uses to set
 * their own password and log in. Owner + staff only.
 *
 * Body: { email*, name?, title? }
 * Returns: { ok, userId, created, inviteUrl }  (operator shares the inviteUrl)
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { createEmployee } from '@/lib/employees/store';

export const runtime = 'nodejs';
export const maxDuration = 20;

function origin(req: NextRequest): string {
  return process.env.MAGIC_LINK_BASE_URL?.replace(/\/+$/, '') || req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/employees/create:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'a valid email is required' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null;

  try {
    const result = await createEmployee({ email, displayName: name || email.split('@')[0], title });
    const inviteUrl = `${origin(req)}/employee/set-password?token=${result.token}`;
    return NextResponse.json({ ok: true, userId: result.userId, created: result.created, inviteUrl });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
