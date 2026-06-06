/**
 * POST /api/admin/av/clients/[client_id]/distress/delete-entity  (val 2026-06-06)
 *
 * Operator inline-delete for watchlist rows. Replaces the "paste cleanup SQL
 * into phpMyAdmin" workflow which is unusable from mobile. Wipes:
 *   1. entity_distress_scores row for (client_id, entity_key)
 *   2. (optional) the upstream public_intel_records that fed it, when
 *      `wipeRecords=true` is sent.
 *
 * Soft-fails to 200 on already-deleted entities so re-taps don't error.
 *
 * Body: { entityKey: string, wipeRecords?: boolean }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader } from 'mysql2';
import { logEvent } from '@/lib/events/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/distress/delete-entity:POST',
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

  let body: { entityKey?: unknown; wipeRecords?: unknown } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const entityKey = typeof body.entityKey === 'string' ? body.entityKey : '';
  const wipeRecords = body.wipeRecords === true;
  if (!entityKey) {
    return NextResponse.json({ error: 'entityKey required' }, { status: 400 });
  }

  const db = getAvDb();
  try {
    const [scoreDel] = await db.execute<ResultSetHeader>(
      `DELETE FROM entity_distress_scores WHERE client_id = ? AND entity_key = ?`,
      [clientId, entityKey]
    );
    let recordsDeleted = 0;
    if (wipeRecords) {
      const [recDel] = await db.execute<ResultSetHeader>(
        `DELETE FROM public_intel_records WHERE client_id = ? AND entity_key = ?`,
        [clientId, entityKey]
      );
      recordsDeleted = recDel.affectedRows ?? 0;
    }
    await logEvent({
      eventType: 'distress.entity_deleted',
      source: 'operator_action',
      status: 'success',
      payload: {
        client_id: clientId,
        entity_key: entityKey,
        wipe_records: wipeRecords,
        scores_deleted: scoreDel.affectedRows ?? 0,
        records_deleted: recordsDeleted,
        actor_id: guard.actor.userId
      }
    });
    return NextResponse.json({
      ok: true,
      scoresDeleted: scoreDel.affectedRows ?? 0,
      recordsDeleted
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
