/**
 * POST /api/client/leads/reject  { leadId }
 *
 * A client passes on a lead that isn't a fit. We:
 *   1. un-assign it (client_id -> NULL)
 *   2. (#303) flag it as dead: lead_status = 'lost', parked_reason notes
 *      which client passed and when — so val can review the dead-leads pool
 *      at /admin/av?stage=lost and decide whether to re-pitch to a different
 *      client or archive permanently.
 *   3. log a lead.client_rejected event so the dedup layer doesn't re-hand
 *      the same lead back to the same client tomorrow.
 *
 * Client-session scoped; a client can only reject a lead that belongs to THEIR
 * account.
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

    // (#303) Set lead_status='lost' so the rejected lead is visibly distinct
    // in val's operator view (filter /admin/av?stage=lost). parked_reason
    // captures who passed + when so she can decide whether to re-pitch to a
    // different client or retire permanently. client_id -> NULL so the lead
    // doesn't stay in the rejecting client's view.
    const parkedReason = `client_rejected:${user.client_id}:${new Date().toISOString().slice(0, 10)}`;
    await db.execute<ResultSetHeader>(
      `UPDATE leads
          SET client_id = NULL,
              lead_status = 'lost',
              parked_reason = ?,
              last_activity_at = NOW()
        WHERE id = ?`,
      [parkedReason, leadId]
    );
    await logEvent({
      eventType: 'lead.client_rejected',
      leadId,
      source: 'client_portal',
      status: 'success',
      payload: {
        client_id: user.client_id,
        by: user.email,
        // (#303) Surfaced explicitly so the dead-leads audit trail is readable
        // without joining back to the leads row.
        new_status: 'lost',
        parked_reason: parkedReason
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
