/**
 * /api/admin/campaigns/lines/[id]/commercial/[asset_id]/attach-lead   (#61 Inc 4)
 *
 * GET  -> { leads: PickableLead[] }  — active leads under the line's owner
 *         so the cockpit can render a dropdown of legal pick targets.
 * POST -> attach: body { leadId } -> sets grok_imagine_assets.lead_id, props
 *         the lead_id onto any queued social drafts (Inc 2), and threads the
 *         lead to the same narrative line as 'advances'.
 *
 * Owner + staff only. AV-tab-gated. Refusals come back 200 with ok=false so
 * the UI can render inline reasons; only auth/shape failures use 4xx.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import {
  attachLineCommercialToLead,
  listLeadsForLineAttach
} from '@/lib/campaigns/attach_line_commercial';

export const runtime = 'nodejs';
export const maxDuration = 30;

function parseLineId(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function commonGuard(req: NextRequest, verb: 'GET' | 'POST') {
  const guard = await guardAdminRequest(req, {
    targetResource: `/api/admin/campaigns/lines/[id]/commercial/[asset_id]/attach-lead:${verb}`,
    tenantId: 'av'
  });
  if (!guard.ok) return { ok: false as const, response: guard.response };
  if (guard.actor.role === 'client_user') {
    return { ok: false as const, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return { ok: false as const, response: NextResponse.json({ error: 'av tab disabled' }, { status: 403 }) };
  }
  return { ok: true as const, actor: guard.actor };
}

export async function GET(req: NextRequest, { params }: { params: { id: string; asset_id: string } }) {
  const g = await commonGuard(req, 'GET');
  if (!g.ok) return g.response;
  const lineId = parseLineId(params.id);
  if (!lineId) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });
  // asset_id is in the path for symmetry with the POST, but the picker
  // doesn't need it — leads are scoped to the line, not the asset.
  const leads = await listLeadsForLineAttach(lineId);
  return NextResponse.json({ ok: true, leads });
}

export async function POST(req: NextRequest, { params }: { params: { id: string; asset_id: string } }) {
  const g = await commonGuard(req, 'POST');
  if (!g.ok) return g.response;

  const lineId = parseLineId(params.id);
  if (!lineId) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });
  const assetId = Number.parseInt(params.asset_id, 10);
  if (!Number.isFinite(assetId) || assetId <= 0) {
    return NextResponse.json({ error: 'invalid asset_id' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }

  const leadId = Number.parseInt(String(body.leadId ?? ''), 10);
  if (!Number.isFinite(leadId) || leadId <= 0) {
    return NextResponse.json({ error: 'leadId is required' }, { status: 400 });
  }

  const result = await attachLineCommercialToLead({
    lineId,
    assetId,
    leadId,
    actorUserId: g.actor.userId
  });
  // Refusals (ownership mismatch, already attached, etc.) come back 200 with
  // ok=false + reason so the UI can render them inline.
  return NextResponse.json(result);
}
