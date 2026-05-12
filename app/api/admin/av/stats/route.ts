import { NextRequest, NextResponse } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface StatsRow extends RowDataPacket {
  total: number;
  cnt_new: number;
  cnt_contacted: number;
  cnt_qualified: number;
  cnt_converted: number;
  cnt_lost: number;
  cnt_ai_scored: number;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/stats',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  try {
    const db = getAvDb();
    const [rows] = await db.execute<StatsRow[]>(
      `SELECT
         COUNT(*)                                                    AS total,
         SUM(CASE WHEN lead_status = 'new'       THEN 1 ELSE 0 END) AS cnt_new,
         SUM(CASE WHEN lead_status = 'contacted' THEN 1 ELSE 0 END) AS cnt_contacted,
         SUM(CASE WHEN lead_status = 'qualified' THEN 1 ELSE 0 END) AS cnt_qualified,
         SUM(CASE WHEN lead_status = 'converted' THEN 1 ELSE 0 END) AS cnt_converted,
         SUM(CASE WHEN lead_status = 'lost'      THEN 1 ELSE 0 END) AS cnt_lost,
         SUM(CASE WHEN ai_score IS NOT NULL       THEN 1 ELSE 0 END) AS cnt_ai_scored
       FROM leads
       WHERE archived_at IS NULL`
    );

    const r = rows[0];
    return NextResponse.json({
      stats: {
        total: Number(r.total),
        byStage: {
          new: Number(r.cnt_new),
          contacted: Number(r.cnt_contacted),
          qualified: Number(r.cnt_qualified),
          converted: Number(r.cnt_converted),
          lost: Number(r.cnt_lost)
        },
        aiScored: Number(r.cnt_ai_scored)
      }
    });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
