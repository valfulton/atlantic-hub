/**
 * POST /api/client/social/outbox/[id]/decide   (#61 Inc 3)
 *
 * Client approves or rejects a queued line-born social draft. Approve flips
 * status='scheduled' + scheduled_for=NOW() (publisher picks up on next cron);
 * reject flips status='canceled' (the row sticks around as audit/learning
 * signal — "client rejected this angle").
 *
 * Auth: client_user session. Tenant-scoped by lib/client/social_review:
 * a client can only act on rows in their own tenant.
 */
import { NextRequest, NextResponse } from 'next/server';
import { headers as nextHeaders } from 'next/headers';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';
import { decideClientReviewItem, type ReviewDecision } from '@/lib/client/social_review';
import { logEvent } from '@/lib/events/log';

export const runtime = 'nodejs';

function parseOutboxId(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseDecision(raw: unknown): ReviewDecision | null {
  if (raw === 'approve' || raw === 'reject') return raw;
  return null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = readClientActorFromHeaders(nextHeaders() as unknown as Headers);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const user = await findClientUserById(actor.clientUserId);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);
  if (!clientId) return NextResponse.json({ error: 'no client scope' }, { status: 403 });

  const outboxId = parseOutboxId(params.id);
  if (!outboxId) return NextResponse.json({ error: 'invalid outbox id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const decision = parseDecision(body.decision);
  if (!decision) {
    return NextResponse.json({ error: 'decision must be "approve" or "reject"' }, { status: 400 });
  }

  // (#61 Inc 4-polish-A) Optional fields — the lib sanitizes (trim + slice).
  const editedBody = typeof body.editedBody === 'string' ? body.editedBody : null;
  const notes = typeof body.notes === 'string' ? body.notes : null;

  const result = await decideClientReviewItem({ clientId, outboxId, decision, editedBody, notes });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? 'could not record decision' }, { status: 409 });
  }

  await logEvent({
    eventType: decision === 'approve' ? 'social.client_approved' : 'social.client_rejected',
    leadId: null,
    userId: null,
    source: 'client_review',
    status: 'success',
    payload: {
      client_id: clientId,
      client_user_id: actor.clientUserId,
      outbox_id: outboxId,
      new_status: result.newStatus
    }
  });

  return NextResponse.json({ ok: true, outboxId: result.outboxId, newStatus: result.newStatus });
}
