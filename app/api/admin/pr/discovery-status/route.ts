/**
 * GET /api/admin/pr/discovery-status
 *
 * Small read for the PR desk header so the autonomous cadence is VISIBLE, not
 * just running in the dark. Returns:
 *   - lastAutoRunAt   : newest pr.discovery.swept event with source='cron'
 *                       (the every-2h scheduled sweep). null until first deploy/run.
 *   - lastRunAt       : newest pr.discovery.swept of any kind (cron or manual).
 *   - suggestedThisWeek: count of suggested pr_opportunities created in the last 7 days.
 *
 * Owner + staff only. Session-guarded (NOT a public/cron path) so guardAdminRequest
 * authenticates from the middleware-set actor headers as normal.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { DEFAULT_TENANT } from '@/lib/pr/types';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface WhenRow extends RowDataPacket {
  created_at: string;
}
interface CountRow extends RowDataPacket {
  n: number;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/pr/discovery-status',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenant') || DEFAULT_TENANT;

  try {
    const db = getAvDb();

    const [autoRows] = await db.execute<WhenRow[]>(
      `SELECT created_at FROM system_events
        WHERE event_type = 'pr.discovery.swept' AND source = 'cron'
        ORDER BY id DESC LIMIT 1`
    );
    const [anyRows] = await db.execute<WhenRow[]>(
      `SELECT created_at FROM system_events
        WHERE event_type = 'pr.discovery.swept'
        ORDER BY id DESC LIMIT 1`
    );
    const [cntRows] = await db.execute<CountRow[]>(
      `SELECT COUNT(*) AS n FROM pr_opportunities
        WHERE tenant_id = ? AND suggested = 1
          AND created_at >= (NOW() - INTERVAL 7 DAY)`,
      [tenantId]
    );

    return NextResponse.json({
      ok: true,
      lastAutoRunAt: autoRows[0]?.created_at ?? null,
      lastRunAt: anyRows[0]?.created_at ?? null,
      suggestedThisWeek: Number(cntRows[0]?.n ?? 0)
    });
  } catch (err) {
    console.error('[pr:discovery-status]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
