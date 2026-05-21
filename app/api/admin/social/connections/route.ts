import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { normalizeTenant } from '@/lib/social/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ConnectionRow extends RowDataPacket {
  id: number;
  provider: string;
  provider_account_id: string;
  display_name: string | null;
  avatar_url: string | null;
  status: string;
  connected_at: string;
  last_used_at: string | null;
}

// GET /api/admin/social/connections?tenant=<id>
// Returns active connections for the tenant. Never returns token columns.
export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/social/connections' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const tenant = normalizeTenant(req.nextUrl.searchParams.get('tenant'));

  try {
    const db = getAvDb();
    const [rows] = await db.execute<ConnectionRow[]>(
      `SELECT id, provider, provider_account_id, display_name, avatar_url, status,
              connected_at, last_used_at
         FROM social_connections
        WHERE tenant_id = ? AND status = 'active'
        ORDER BY connected_at DESC`,
      [tenant]
    );
    return NextResponse.json({
      tenant,
      connections: rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        providerAccountId: r.provider_account_id,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        status: r.status,
        connectedAt: r.connected_at,
        lastUsedAt: r.last_used_at
      }))
    });
  } catch (err) {
    console.error('[social:connections:get]', (err as Error).name, (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
