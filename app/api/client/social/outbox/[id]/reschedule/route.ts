/**
 * POST /api/client/social/outbox/[id]/reschedule
 *
 * Client drags one of their own queued/scheduled posts to a new day on the
 * calendar. Updates `scheduled_for` ONLY — never the publish gate. (val
 * 2026-06-05: clients get real flexibility over their social calendar; see
 * feedback_client_calendar_max.) Approval still governs whether a draft goes
 * out — this moves WHEN, not WHETHER.
 *
 * Security: scoped by tenant_id = `client:<activeClientId>` exactly like the
 * decide endpoint (lib/client/social_review). A client can only move rows in
 * their own tenant, and only items not already published/publishing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { headers as nextHeaders } from 'next/headers';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

// Only future-facing items can move. Never reschedule something already out the
// door (published/publishing) or dead (failed/canceled).
const RESCHEDULABLE = new Set(['draft', 'scheduled']);

function parseId(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** ISO (or YYYY-MM-DD) → MySQL DATETIME string, or null if unparseable. */
function toMysqlDateTime(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = readClientActorFromHeaders(nextHeaders() as unknown as Headers);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const user = await findClientUserById(actor.clientUserId);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);
  if (!clientId) return NextResponse.json({ error: 'no client scope' }, { status: 403 });
  const tenantId = `client:${clientId}`;

  const id = parseId(params.id);
  if (!id) return NextResponse.json({ error: 'invalid outbox id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const scheduledFor = toMysqlDateTime(body.scheduledFor);
  if (!scheduledFor) return NextResponse.json({ error: 'scheduledFor must be a valid date' }, { status: 400 });

  const db = getAvDb();

  // Verify ownership + reschedulable status BEFORE writing (tenant-scoped read).
  const [rows] = await db.execute<(RowDataPacket & { status: string })[]>(
    `SELECT status FROM social_outbox WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [id, tenantId]
  );
  if (!rows[0]) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!RESCHEDULABLE.has(rows[0].status)) {
    return NextResponse.json({ error: `cannot reschedule a ${rows[0].status} post` }, { status: 409 });
  }

  // scheduled_for only — status untouched, so the approval gate is unchanged.
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE social_outbox SET scheduled_for = ?
      WHERE id = ? AND tenant_id = ? AND status IN ('draft','scheduled')`,
    [scheduledFor, id, tenantId]
  );
  if (res.affectedRows === 0) {
    return NextResponse.json({ error: 'could not reschedule' }, { status: 409 });
  }

  await logEvent({
    eventType: 'social.client_rescheduled',
    leadId: null,
    userId: null,
    source: 'client_calendar',
    status: 'success',
    payload: { client_id: clientId, client_user_id: actor.clientUserId, outbox_id: id, scheduled_for: scheduledFor }
  });

  return NextResponse.json({ ok: true, id, scheduledFor });
}
