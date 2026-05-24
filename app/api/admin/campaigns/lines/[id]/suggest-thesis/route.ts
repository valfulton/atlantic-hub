/**
 * POST /api/admin/campaigns/lines/[id]/suggest-thesis
 *
 * Propose new narrative-line theses grounded in the owner's lead needs.
 * One small LLM call. Owner + staff only. Returns { ok, suggestions: [...] }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { suggestThesesForLine } from '@/lib/campaigns/thesis_suggest';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/lines/suggest-thesis:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const lineId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(lineId) || lineId <= 0) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });
  try {
    const suggestions = await suggestThesesForLine(lineId);
    return NextResponse.json({ ok: true, suggestions });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
