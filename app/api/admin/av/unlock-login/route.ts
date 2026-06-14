/**
 * POST /api/admin/av/unlock-login
 *
 * (val 2026-06-13) One-click clears the client-login rate-limit buckets.
 * The login endpoint caps at 5 attempts / 15 min per IP (lib/rate-limit.ts);
 * when a client (or val testing) trips it they see "too many attempts" for
 * up to 15 minutes. This endpoint wipes the lockout immediately.
 *
 * Scope: all `client-login:*` bucket keys on the platform db.
 *   - Does NOT touch API or webhook buckets.
 *   - Fresh 5-attempt window for everyone.
 *
 * Operator-only. No body required.
 * Returns: { ok: true, cleared: <count> }
 */
import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';
import { guardAdminRequest } from '@/lib/api-guard';
import { getPlatformDb } from '@/lib/db/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: 'unlock_login_rate_limit',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const db = getPlatformDb();
  const [res] = await db.execute<ResultSetHeader>(
    `DELETE FROM rate_limit_buckets WHERE bucket_key LIKE 'client-login:%'`
  );

  return NextResponse.json({ ok: true, cleared: res.affectedRows });
}
