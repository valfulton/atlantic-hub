/**
 * /api/admin/campaigns/lines/[id]/engagement
 *
 * The learning-loop capture surface for one narrative line.
 *
 * GET   -> rollup summary for the line (totals, per-channel, recent entries).
 * POST  -> { mode: 'manual', channel, impressions?, engagements?, clicks?,
 *            conversions?, periodStart?, periodEnd?, campaignId?, note? }
 *            records a manual reading.
 *       -> { mode: 'pull' } attempts an auto-pull from connected socials
 *            (stubbed until task #45; returns ok:false with a friendly message).
 *
 * Owner + staff only. Operator surface — never client-facing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import {
  recordEngagement, getLineEngagementSummary, pullEngagementFromSocials, normalizeChannel
} from '@/lib/campaigns/engagement';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/lines/engagement:GET', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const lineId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(lineId) || lineId <= 0) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });
  try {
    const summary = await getLineEngagementSummary(lineId);
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/lines/engagement:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const lineId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(lineId) || lineId <= 0) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const mode = typeof body.mode === 'string' ? body.mode : 'manual';

  try {
    if (mode === 'pull') {
      const result = await pullEngagementFromSocials(lineId);
      // 200 with ok:false — not an error, just "not connected yet".
      return NextResponse.json(result, { status: 200 });
    }

    const num = (k: string): number | undefined => {
      const n = Number(body[k]);
      return Number.isFinite(n) ? n : undefined;
    };
    const id = await recordEngagement({
      tenantId: typeof body.tenant === 'string' ? body.tenant : 'av',
      narrativeLineId: lineId,
      campaignId: typeof body.campaignId === 'number' ? body.campaignId : null,
      channel: normalizeChannel(body.channel),
      periodStart: typeof body.periodStart === 'string' ? body.periodStart : null,
      periodEnd: typeof body.periodEnd === 'string' ? body.periodEnd : null,
      impressions: num('impressions'),
      engagements: num('engagements'),
      clicks: num('clicks'),
      conversions: num('conversions'),
      note: typeof body.note === 'string' ? body.note : null,
      userId: guard.actor.userId
    });
    const summary = await getLineEngagementSummary(lineId);
    return NextResponse.json({ ok: true, id, summary });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
