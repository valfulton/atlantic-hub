/**
 * GET /api/admin/campaigns/lines/[id]/commercials
 *
 * Commercials/assets attributed to a narrative line (through its campaigns).
 * Read-only; powers the cockpit's "Commercials on this line" gallery.
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { listLineCommercials, listLineRunningVideoAssetIds } from '@/lib/campaigns/store';
import { resumeRunningVideoAsset } from '@/lib/grok/discoverer';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/lines/commercials:GET', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const lineId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(lineId) || lineId <= 0) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });
  try {
    // Line-born videos render async and have NO lead, so the per-lead GET route
    // never resumes them. Poll this line's still-running videos here so they flip
    // to done/failed when the cockpit opens the line — no cron required.
    const runningIds = await listLineRunningVideoAssetIds(lineId);
    if (runningIds.length > 0) {
      await Promise.allSettled(runningIds.map((id) => resumeRunningVideoAsset(id)));
    }
    const commercials = await listLineCommercials(lineId);
    return NextResponse.json({ ok: true, commercials });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
