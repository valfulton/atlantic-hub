/**
 * POST /api/admin/social/publish/[outbox_id]
 *
 * Publish a queued social_outbox row to its connected provider NOW. Owner +
 * staff only. This is the operator "Publish" action; the composer + scheduled
 * cron can call the same lib/social/publish entrypoint later.
 *
 * v1 posts caption text (commercial linked in-caption). See lib/social/publish.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { publishOutboxRow, OutboxRowNotFoundError } from '@/lib/social/publish';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { outbox_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/social/publish/[outbox_id]:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const outboxId = Number.parseInt(params.outbox_id, 10);
  if (!Number.isFinite(outboxId) || outboxId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  try {
    const result = await publishOutboxRow(outboxId);
    return NextResponse.json({ ...result }, { status: result.ok ? 200 : 502 });
  } catch (err) {
    if (err instanceof OutboxRowNotFoundError) {
      return NextResponse.json({ error: 'outbox row not found' }, { status: 404 });
    }
    console.error('[social:publish]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
