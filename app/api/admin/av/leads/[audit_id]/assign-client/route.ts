/**
 * POST /api/admin/av/leads/[audit_id]/assign-client
 *
 * Hand a lead off to a client: sets leads.client_id so the lead appears in that
 * client's scoped pipeline (/client/leads). Pass { clientId: null } to unassign
 * (return it to the operator/house pipeline). Owner + staff only.
 *
 * This is the operator lead-handoff (#79) — val curates prospects and passes them
 * to a client (e.g. Skip & Mike) to work.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/leads/assign-client:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_av_enabled'))) return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });

  if (!UUID_RE.test(params.audit_id)) return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });

  let body: { clientId?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  let clientId: number | null = null;
  if (body.clientId != null && body.clientId !== '') {
    const n = Number.parseInt(String(body.clientId), 10);
    if (!Number.isFinite(n) || n <= 0) return NextResponse.json({ error: 'invalid clientId' }, { status: 400 });
    clientId = n;
  }

  try {
    const db = getAvDb();
    // If assigning (not unassigning), verify the client exists.
    if (clientId != null) {
      const [crows] = await db.execute<(import('mysql2').RowDataPacket & { client_id: number })[]>(
        `SELECT client_id FROM clients WHERE client_id = ? AND archived_at IS NULL LIMIT 1`,
        [clientId]
      );
      if (!crows[0]) return NextResponse.json({ error: 'client not found' }, { status: 404 });
    }

    // (#188) Read the lead's PRIOR client_id + id BEFORE the UPDATE so we can
    // clean up the prior owner's stale guidance if the lead is changing hands.
    const [priorRows] = await db.execute<(import('mysql2').RowDataPacket & { id: number; client_id: number | null })[]>(
      `SELECT id, client_id FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
      [params.audit_id]
    );
    const prior = priorRows[0];
    if (!prior) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE leads SET client_id = ?, last_activity_at = NOW() WHERE audit_id = ? AND archived_at IS NULL`,
      [clientId, params.audit_id]
    );
    if (!res.affectedRows) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

    // (#188) If the lead just LEFT a client (priorClientId set, and either
    // unassigned or moved to a different client), wipe stale next_best_moves +
    // momentum_signals under the prior client's tenant pegged to this lead.
    let guidanceCleaned = 0;
    if (prior.client_id != null && prior.client_id !== clientId) {
      const [delRes] = await db.execute<ResultSetHeader>(
        `DELETE FROM intelligence_objects
          WHERE tenant_id = ?
            AND object_type IN ('next_best_moves','momentum_signals')
            AND lead_id = ?`,
        [`client:${prior.client_id}`, prior.id]
      );
      guidanceCleaned = delRes.affectedRows ?? 0;
    }

    return NextResponse.json({ ok: true, clientId, guidanceCleaned });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
