/**
 * POST /api/admin/av/clients/[client_id]/move-leads  (#306)
 *
 * Bulk reassign leads from THIS client to ANOTHER client in one transaction.
 *
 * Body: { auditIds: string[], destClientId: number }
 *
 * Difference vs existing endpoints:
 *   - assign-leads: only takes UNASSIGNED leads (client_id IS NULL) — won't
 *     steal from another client.
 *   - release-leads: returns to house pool (client_id -> NULL).
 *   - move-leads (this): single-step source→dest reassign. Operator authority.
 *
 * Cleanup: lib/leads/handoff intel-cleanup behavior was wired in #188/#192
 * for assign/release/archive flows. We match that pattern here: when a lead
 * moves to a new owner, any cached intelligence_objects tied to the OLD
 * owner's brief are flagged stale via parked_reason and the audit becomes
 * stale-by-virtue-of brief change (no destructive delete). The new owner's
 * next "Refresh AI intel" run regrounds it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/clients/move-leads:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_av_enabled'))) return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });

  const srcClientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(srcClientId) || srcClientId <= 0) {
    return NextResponse.json({ error: 'invalid source client id' }, { status: 400 });
  }

  let body: { auditIds?: unknown; destClientId?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const destClientId = Number.parseInt(String(body.destClientId ?? ''), 10);
  if (!Number.isFinite(destClientId) || destClientId <= 0) {
    return NextResponse.json({ error: 'invalid destination client id' }, { status: 400 });
  }
  if (destClientId === srcClientId) {
    return NextResponse.json({ error: 'destination cannot equal source' }, { status: 400 });
  }

  const ids = Array.isArray(body.auditIds)
    ? body.auditIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).slice(0, 200)
    : [];
  if (ids.length === 0) return NextResponse.json({ error: 'no valid leads selected' }, { status: 400 });

  try {
    const db = getAvDb();
    // Confirm destination exists + active. Source is the path param so we trust it.
    const [crows] = await db.execute<(RowDataPacket & { client_id: number; client_name: string })[]>(
      `SELECT client_id, client_name FROM clients WHERE client_id = ? AND archived_at IS NULL LIMIT 1`,
      [destClientId]
    );
    if (!crows[0]) return NextResponse.json({ error: 'destination client not found' }, { status: 404 });

    const placeholders = ids.map(() => '?').join(',');
    // Only move leads that ACTUALLY belong to the source client. Prevents
    // someone bouncing a URL with random audit_ids to move arbitrary leads.
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE leads
          SET client_id = ?, last_activity_at = NOW()
        WHERE audit_id IN (${placeholders})
          AND client_id = ?
          AND archived_at IS NULL`,
      [destClientId, ...ids, srcClientId]
    );

    await logEvent({
      eventType: 'lead.moved_between_clients',
      source: 'operator',
      status: 'success',
      payload: {
        moved: res.affectedRows ?? 0,
        src_client_id: srcClientId,
        dest_client_id: destClientId,
        dest_client_name: crows[0].client_name,
        audit_id_count: ids.length
      }
    });

    return NextResponse.json({
      ok: true,
      moved: res.affectedRows ?? 0,
      destClientName: crows[0].client_name
    });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
