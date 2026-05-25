/**
 * POST /api/client/leads/reject  { leadId }
 *
 * A client passes on a lead that isn't a fit. We un-assign it (client_id -> NULL)
 * so it returns to the operator's pipeline, and log an event so val sees it was
 * rejected (and shouldn't just re-hand the same one). Client-session scoped; a
 * client can only reject a lead that belongs to THEIR account.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 20;

export async function POST(req: NextRequest) {
  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const user = await findClientUserById(actor.clientUserId);
  if (!user || !user.client_id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { leadId?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const leadId = Number.parseInt(String(body.leadId ?? ''), 10);
  if (!Number.isFinite(leadId) || leadId <= 0) return NextResponse.json({ error: 'invalid leadId' }, { status: 400 });

  try {
    const db = getAvDb();
    // Only a lead that belongs to THIS client can be rejected by them.
    const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM leads WHERE id = ? AND client_id = ? AND archived_at IS NULL LIMIT 1`,
      [leadId, user.client_id]
    );
    if (!rows[0]) return NextResponse.json({ error: 'not your lead' }, { status: 404 });

    await db.execute<ResultSetHeader>(
      `UPDATE leads SET client_id = NULL, last_activity_at = NOW() WHERE id = ?`,
      [leadId]
    );
    await logEvent({
      eventType: 'lead.client_rejected',
      leadId,
      source: 'client_portal',
      status: 'success',
      payload: { client_id: user.client_id, by: user.email }
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
