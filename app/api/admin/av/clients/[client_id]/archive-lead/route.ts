/**
 * POST /api/admin/av/clients/[client_id]/archive-lead  { leadId }
 *
 * Soft-delete (archive) a lead that belongs to THIS client — the operator way to
 * clear a stray / mis-assigned lead from a client's pipeline without the DB or
 * the lead-detail page. Scoped: only archives a lead whose client_id matches, so
 * you can't accidentally nuke someone else's lead from here. Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/clients/archive-lead:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) return NextResponse.json({ error: 'invalid client id' }, { status: 400 });

  let body: { leadId?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const leadId = Number.parseInt(String(body.leadId ?? ''), 10);
  if (!Number.isFinite(leadId) || leadId <= 0) return NextResponse.json({ error: 'invalid leadId' }, { status: 400 });

  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE leads SET archived_at = NOW(), last_activity_at = NOW()
        WHERE id = ? AND client_id = ? AND archived_at IS NULL`,
      [leadId, clientId]
    );
    if (!res.affectedRows) return NextResponse.json({ error: 'not this client\'s lead' }, { status: 404 });

    await logEvent({
      eventType: 'lead.archived',
      leadId,
      userId: guard.actor.userId ?? null,
      source: 'operator_client_page',
      payload: { client_id: clientId }
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
