/**
 * GET /api/admin/av/pipeline-value
 *
 * Returns the pipeline $ rollup for the excitement card at the top of
 * /admin/av. Computed by lib/sales/pipeline_value.ts. Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { computePipelineValue } from '@/lib/sales/pipeline_value';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/pipeline-value',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const value = await computePipelineValue();
    return NextResponse.json(value);
  } catch (err) {
    return NextResponse.json(
      { error: 'server error', message: (err as Error).message.slice(0, 300) },
      { status: 500 }
    );
  }
}
