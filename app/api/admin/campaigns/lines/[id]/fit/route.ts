/**
 * GET /api/admin/campaigns/lines/[id]/fit
 *
 * How many of the line owner's leads this narrative line speaks to (+ the
 * "why" terms). Powers the cockpit's "defend the push order" readout.
 * Pure data. Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getLineLeadFit } from '@/lib/campaigns/line_fit';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/lines/fit:GET', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const lineId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(lineId) || lineId <= 0) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });
  try {
    const fit = await getLineLeadFit(lineId);
    return NextResponse.json({ ok: true, fit });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
