import { NextRequest, NextResponse } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled, mysqlBoolToJs } from '@/lib/feature-flags';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface StageRow extends RowDataPacket {
  pipeline_stage_id: number;
  stage_key: string;
  stage_name: string;
  stage_order: number;
  is_terminal: unknown;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/stages',
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
    const [rows] = await db.execute<StageRow[]>(
      `SELECT ps.pipeline_stage_id, ps.stage_key, ps.stage_name, ps.stage_order, ps.is_terminal
       FROM pipeline_stages ps
       JOIN clients c ON c.client_id = ps.client_id
       WHERE c.client_slug = 'av-internal'
         AND ps.archived_at IS NULL
       ORDER BY ps.stage_order`
    );

    const stages = rows.map((r) => ({
      pipelineStageId: r.pipeline_stage_id,
      stageKey: r.stage_key,
      stageName: r.stage_name,
      stageOrder: r.stage_order,
      isTerminal: mysqlBoolToJs(r.is_terminal)
    }));

    return NextResponse.json({ stages });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
