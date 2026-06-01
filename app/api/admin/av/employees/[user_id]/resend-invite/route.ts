/**
 * POST /api/admin/av/employees/[user_id]/resend-invite  (#301)
 *
 * Re-issue a fresh set-password link for an existing employee. The
 * underlying logic is the same as `createEmployee()` — on duplicate email it
 * already overwrites `set_password_token` + `set_password_expires_at`. This
 * endpoint exposes that path explicitly so val (or any operator) can resend
 * Rebecca's link without having to fake a duplicate-create.
 *
 * Response: { ok: true, link, expiresInDays } where link is the absolute URL
 * the employee uses to set their password. Token TTL matches the original
 * (lib/employees/store.ts TOKEN_TTL_DAYS).
 *
 * Operator-only — middleware role guard plus an explicit guardAdminRequest
 * call here. Reads the employee's existing email + display_name from
 * admin_users so the operator never re-types them.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/auth/guard';
import { getPlatformDb } from '@/lib/db/platform';
import { createEmployee, getEmployee } from '@/lib/employees/store';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { user_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/employees/resend-invite',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  const userId = Number.parseInt(params.user_id, 10);
  if (!Number.isFinite(userId) || userId <= 0) {
    return NextResponse.json({ ok: false, error: 'bad user_id' }, { status: 400 });
  }

  // Pull the employee's identity from admin_users so the operator doesn't
  // have to re-supply name/email — they live on the page already.
  const platform = getPlatformDb();
  const [rows] = await platform.execute<(RowDataPacket & { email: string; display_name: string | null })[]>(
    `SELECT email, display_name FROM admin_users WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  if (!rows[0]) {
    return NextResponse.json({ ok: false, error: 'employee not found' }, { status: 404 });
  }

  // Title comes from the employee_profiles row (AV DB). Preserve it.
  let title: string | null = null;
  try {
    const emp = await getEmployee(userId);
    title = emp?.title ?? null;
  } catch { /* non-fatal */ }

  const result = await createEmployee({
    email: rows[0].email,
    displayName: rows[0].display_name || rows[0].email.split('@')[0],
    title
  });

  // Build the absolute set-password URL using the request's origin so we work
  // in both prod (atlantic-hub.netlify.app) and any preview/branch deploy.
  const origin = req.nextUrl.origin;
  const link = `${origin}/api/employee/set-password?token=${encodeURIComponent(result.token)}`;
  const TTL_DAYS = 14; // matches lib/employees/store.ts TOKEN_TTL_DAYS

  return NextResponse.json({
    ok: true,
    link,
    email: rows[0].email,
    expiresInDays: TTL_DAYS,
    wasNew: result.created
  });
}
