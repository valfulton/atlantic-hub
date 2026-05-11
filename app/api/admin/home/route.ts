/**
 * GET /api/admin/home
 *
 * Cross-company totals for the dashboard home page.
 * v1: MRR + counts pulled from tenant_account_link only.
 * v2: rich recent-activity feed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getPlatformDb } from '@/lib/db/platform';
import { guardAdminRequest } from '@/lib/api-guard';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/home' });
  if (!guard.ok) return guard.response;

  try {
    const db = getPlatformDb();
    const [totalsByTenant] = await db.execute<(RowDataPacket & {
      tenant_id: string;
      active_count: number;
      total_count: number;
      mrr_cents: number;
    })[]>(
      `SELECT
         tenant_id,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
         COUNT(*) AS total_count,
         COALESCE(SUM(mrr_cents), 0) AS mrr_cents
       FROM tenant_account_link
       GROUP BY tenant_id`
    );

    const [recentActivity] = await db.execute<(RowDataPacket & {
      tenant_id: string;
      account_type: string;
      linked_at: string;
    })[]>(
      `SELECT tenant_id, account_type, linked_at
       FROM tenant_account_link
       ORDER BY linked_at DESC
       LIMIT 20`
    );

    return NextResponse.json({
      tenants: totalsByTenant.map((t) => ({
        tenantId: t.tenant_id,
        activeCount: Number(t.active_count),
        totalCount: Number(t.total_count),
        mrrCents: Number(t.mrr_cents)
      })),
      recentActivity: recentActivity.map((r) => ({
        tenantId: r.tenant_id,
        accountType: r.account_type,
        linkedAt: r.linked_at
      }))
    });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
