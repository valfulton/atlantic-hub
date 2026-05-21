import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/admin/social/connections/[id]/disconnect
// Soft-revoke: sets status='revoked'. Tokens are left encrypted at rest
// (never returned); a future pass can also call provider token revocation.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: `/api/admin/social/connections/${params.id}/disconnect`
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  try {
    const db = getAvDb();
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE social_connections
          SET status = 'revoked', last_error = NULL
        WHERE id = ? AND status = 'active'`,
      [id]
    );
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: 'not found or already revoked' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error('[social:connections:disconnect]', (err as Error).name, (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
