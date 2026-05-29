/**
 * /api/admin/av/clients/[client_id]/pr-inbox  (#226)
 *
 * GET  -> returns the current PR inbox record for this client (slug + email
 *         + set-at timestamp). Returns null fields if not generated yet.
 * POST -> generates a fresh slug (overwriting any existing slug). The new
 *         address is live immediately at /api/pr/inbox/<slug>. Old slug stops
 *         working at the same moment.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getInboxRecord, generateAndPersistSlug } from '@/lib/clients/pr_inbox';
import { logEvent } from '@/lib/events/log';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/pr-inbox:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  try {
    const record = await getInboxRecord(clientId);
    if (!record) return NextResponse.json({ error: 'client_not_found' }, { status: 404 });
    return NextResponse.json({ ok: true, ...record });
  } catch (err) {
    console.error('[pr-inbox:get]', (err as Error).message);
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/pr-inbox:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  try {
    const existing = await getInboxRecord(clientId);
    if (!existing) return NextResponse.json({ error: 'client_not_found' }, { status: 404 });

    const result = await generateAndPersistSlug(clientId, existing.clientName);
    await logEvent({
      eventType: 'client.pr_inbox_slug_rotated',
      userId: guard.actor.userId,
      source: 'manual',
      payload: {
        client_id: clientId,
        new_slug: result.slug,
        previous_slug: existing.slug,
        previously_set_at: existing.setAt
      }
    });
    return NextResponse.json({
      ok: true,
      clientId,
      clientName: existing.clientName,
      slug: result.slug,
      email: result.email,
      setAt: result.setAt,
      previousSlug: existing.slug,
      previousSetAt: existing.setAt
    });
  } catch (err) {
    console.error('[pr-inbox:rotate]', (err as Error).message);
    return NextResponse.json({ error: 'rotate_failed', message: (err as Error).message.slice(0, 300) }, { status: 500 });
  }
}
