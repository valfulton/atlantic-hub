/**
 * GET /api/admin/llm/spend-today  (#367, val 2026-06-02)
 *
 * Tiny tenant-wide LLM spend rollup for the operator sidebar chip. Returns
 * the last 24h numbers (live $ + cache hit count). Owner / staff only —
 * client_user can't see operator-side cost data.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { totalSpendLastDays } from '@/lib/llm/spend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/llm/spend-today:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // 1-day window (the helper takes days; 1 is the smallest sensible unit).
  // For sub-day precision the SQL would have to change to INTERVAL HOUR;
  // 24h is what val asked for here.
  const today = await totalSpendLastDays(1);
  return NextResponse.json({
    ok: true,
    windowDays: 1,
    liveMicrocents: today.liveMicrocents,
    liveCallCount: today.liveCallCount,
    cacheHitCount: today.cacheHitCount
  });
}
