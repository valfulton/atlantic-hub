/**
 * GET /api/admin/campaigns/lines/[id]/produced
 *
 * The written/queued assets a narrative line has PRODUCED — posts, blogs,
 * pitches, releases that thread back to it (advances/reinforces/tests). Powers
 * the cockpit's "What this story has produced" rollup so the operator can watch
 * a story working. Commercials are excluded here (separate gallery). Read-only.
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { listLineProducedAssets } from '@/lib/campaigns/line_links';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/lines/produced:GET', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const lineId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(lineId) || lineId <= 0) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });
  try {
    const produced = await listLineProducedAssets(lineId);
    return NextResponse.json({ ok: true, produced });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
