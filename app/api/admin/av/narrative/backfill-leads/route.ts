/**
 * POST /api/admin/av/narrative/backfill-leads   (#46 spine Inc 6)
 *
 * One-click backfill of legacy un-threaded leads to their best-fit narrative
 * line. Thin auth + dispatch wrapper around backfillLeadsToLines — the lib
 * helper caps the batch and skips low-confidence fits, so the worst case is a
 * fast no-op when nothing is unlinked or nothing matches.
 *
 * Owner + staff only. AV-tab-gated like the rest of the av admin surface.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { backfillLeadsToLines } from '@/lib/campaigns/lines_for_lead';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/narrative/backfill-leads:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  // Optional ?limit=N to throttle further during testing — the lib caps it
  // at BACKFILL_CAP regardless, so this is safe to expose.
  let limit: number | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const n = Number.parseInt(String(body.limit ?? ''), 10);
    if (Number.isFinite(n) && n > 0) limit = n;
  } catch { /* empty body OK */ }

  const result = await backfillLeadsToLines({ limit });
  return NextResponse.json({ ok: true, ...result });
}
