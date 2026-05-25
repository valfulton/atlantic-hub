/**
 * /api/admin/social/publishing-pause  — the "stop the presses" control.
 *
 * GET  -> current pause state { paused, reason, updatedBy, updatedAt }.
 * POST -> set it. Body: { paused: boolean, reason?: string }.
 *
 * Owner + staff only (this is the CFO-grade kill switch, e.g. Rebecca). Client
 * users are forbidden. Enforcement lives in lib/social/publish + the publish-due
 * cron; this route just flips the flag.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getPublishingPause, setPublishingPause } from '@/lib/social/publishing_control';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/social/publishing-pause:GET', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    const state = await getPublishingPause();
    return NextResponse.json({ ok: true, ...state });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/social/publishing-pause:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (typeof body.paused !== 'boolean') {
    return NextResponse.json({ error: 'paused (boolean) is required' }, { status: 400 });
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
  const by = `${guard.actor.role}#${guard.actor.userId}`;

  try {
    await setPublishingPause(body.paused, reason, by);
    const state = await getPublishingPause();
    return NextResponse.json({ ok: true, ...state });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
