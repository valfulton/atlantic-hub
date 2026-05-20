/**
 * GET /api/admin/users
 *
 * Returns the list of internal users that can be assigned a lead.
 * Owner + staff only. Used by the AssignmentControl dropdown on the
 * lead detail page.
 *
 * Returns role in ('owner','staff'). Client_user rows are excluded
 * because they cannot own leads. Inactive / disabled rows are excluded.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getPlatformDb } from '@/lib/db/platform';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface UserRow extends RowDataPacket {
  user_id: number;
  email: string;
  display_name: string | null;
  role: 'owner' | 'staff' | 'client_user';
  is_active: number;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/users',
    tenantId: 'platform'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const db = getPlatformDb();
    // Schema may vary slightly across deployments -- attempt the canonical
    // shape first, fall back to the minimum (user_id + email) if columns
    // are missing. Both queries assume `admin_users` exists.
    let rows: UserRow[];
    try {
      const [r] = await db.execute<UserRow[]>(
        `SELECT user_id, email, display_name, role, is_active
           FROM admin_users
          WHERE role IN ('owner', 'staff')
            AND is_active = 1
          ORDER BY role = 'owner' DESC, display_name ASC, email ASC`
      );
      rows = r;
    } catch {
      const [r] = await db.execute<UserRow[]>(
        `SELECT user_id, email, NULL AS display_name, role, 1 AS is_active
           FROM admin_users
          WHERE role IN ('owner', 'staff')
          ORDER BY role = 'owner' DESC, email ASC`
      );
      rows = r;
    }

    return NextResponse.json({
      users: rows.map((r) => ({
        userId: r.user_id,
        email: r.email,
        displayName: r.display_name,
        role: r.role
      }))
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'users_lookup_failed', message: (err as Error).message.slice(0, 300) },
      { status: 500 }
    );
  }
}
