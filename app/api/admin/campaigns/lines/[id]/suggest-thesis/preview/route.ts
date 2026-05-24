/**
 * POST /api/admin/campaigns/lines/[id]/suggest-thesis/preview
 *
 * Returns the EXACT prompt that will be sent to the model — so the operator can
 * read/edit it before spending a single token. NO LLM call. Owner + staff only.
 * Returns { ok, prompt, totalLeads }.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { buildThesisSuggestPrompt } from '@/lib/campaigns/thesis_suggest';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/lines/suggest-thesis/preview:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const lineId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(lineId) || lineId <= 0) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });
  try {
    const built = await buildThesisSuggestPrompt(lineId);
    if (!built) return NextResponse.json({ error: 'line not found' }, { status: 404 });
    return NextResponse.json({ ok: true, prompt: built.user, totalLeads: built.totalLeads });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
