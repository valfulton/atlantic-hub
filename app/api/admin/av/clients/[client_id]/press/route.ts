/**
 * POST   /api/admin/av/clients/[client_id]/press  — log a new press touch
 * PATCH  /api/admin/av/clients/[client_id]/press  — update status (+ optional URL)
 *
 * Operator-only. client_user role is rejected.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { logPressTouch, updatePressTouchStatus } from '@/lib/client/press_touches';
import type { PressTouchChannel, PressTouchStatus } from '@/lib/client/press_touches';

export const runtime = 'nodejs';

const VALID_STATUSES: PressTouchStatus[] = [
  'drafted', 'pitched', 'replied', 'published', 'declined', 'no_response'
];
const VALID_CHANNELS: PressTouchChannel[] = ['email', 'phone', 'social_dm', 'event', 'other'];

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/press:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const journalist = typeof body.journalist === 'string' ? body.journalist.trim() : '';
  const outlet = typeof body.outlet === 'string' ? body.outlet.trim() : '';
  if (!journalist || !outlet) {
    return NextResponse.json({ error: 'journalist + outlet required' }, { status: 400 });
  }

  const status: PressTouchStatus = VALID_STATUSES.includes(body.status as PressTouchStatus)
    ? (body.status as PressTouchStatus) : 'drafted';
  const channel: PressTouchChannel = VALID_CHANNELS.includes(body.channel as PressTouchChannel)
    ? (body.channel as PressTouchChannel) : 'email';

  const touchId = await logPressTouch({
    clientId,
    journalist,
    outlet,
    journalistEmail: typeof body.journalistEmail === 'string' ? body.journalistEmail.trim() : null,
    beat: typeof body.beat === 'string' ? body.beat.trim() : null,
    channel,
    status,
    subject: typeof body.subject === 'string' ? body.subject.trim() : null,
    notes: typeof body.notes === 'string' ? body.notes.trim() : null,
    relatedLeadId: Number.isInteger(body.relatedLeadId) ? (body.relatedLeadId as number) : null,
    relatedBriefKey: typeof body.relatedBriefKey === 'string' ? body.relatedBriefKey : null,
    createdByUserId: guard.actor.userId ?? null
  });

  if (!touchId) {
    return NextResponse.json({ error: 'could not save the touch (schema may be missing)' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, touchId });
}

export async function PATCH(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/press:PATCH',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: { touchId?: number; status?: PressTouchStatus; url?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const touchId = Number(body.touchId);
  if (!Number.isFinite(touchId) || touchId <= 0) {
    return NextResponse.json({ error: 'touchId required' }, { status: 400 });
  }
  if (!body.status || !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }

  const ok = await updatePressTouchStatus(touchId, body.status, body.url ?? null);
  if (!ok) return NextResponse.json({ error: 'could not update' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
