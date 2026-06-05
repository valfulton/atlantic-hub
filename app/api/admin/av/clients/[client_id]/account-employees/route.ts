/**
 * /api/admin/av/clients/[client_id]/account-employees  (#377)
 *
 * Operator-side CRUD for AV-employee assignments to a client account.
 *   GET    → list current assignees + assignable pool (for the panel UI)
 *   POST   → assign an employee at a role (body: { userId, role })
 *
 * DELETE for unassign lives in the sibling [user_id]/route.ts file so the
 * URL carries the target — easier for the panel UI to call.
 *
 * Owner/staff only. client_user is forbidden.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import {
  listAccountEmployees,
  listAssignableEmployees,
  assignEmployee,
  type AccountEmployeeRole
} from '@/lib/av/account_employees';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseClientId(p: { client_id: string }): number | null {
  const n = Number.parseInt(p.client_id, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[id]/account-employees:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = parseClientId(params);
  if (!clientId) return NextResponse.json({ error: 'bad client_id' }, { status: 400 });

  const [assigned, assignable] = await Promise.all([
    listAccountEmployees(clientId),
    listAssignableEmployees(clientId)
  ]);
  return NextResponse.json({ ok: true, assigned, assignable });
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[id]/account-employees:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = parseClientId(params);
  if (!clientId) return NextResponse.json({ error: 'bad client_id' }, { status: 400 });

  let body: { userId?: unknown; role?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const userId = Number(body.userId);
  const role = body.role as AccountEmployeeRole;
  if (!Number.isFinite(userId) || userId <= 0) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 });
  }
  if (role !== 'primary_rep' && role !== 'rep' && role !== 'support') {
    return NextResponse.json({ error: 'role must be primary_rep | rep | support' }, { status: 400 });
  }

  const result = await assignEmployee(clientId, userId, role);
  if (!result.ok) return NextResponse.json({ error: result.error ?? 'assign failed' }, { status: 400 });

  // Refresh the list so the panel can re-render in one round trip.
  const assigned = await listAccountEmployees(clientId);
  return NextResponse.json({ ok: true, created: result.created, demotedPriorPrimary: result.demotedPriorPrimary, assigned });
}
