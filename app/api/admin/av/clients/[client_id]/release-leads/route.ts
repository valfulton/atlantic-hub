/**
 * POST /api/admin/av/clients/[client_id]/release-leads
 *
 * Bulk take-back (#96): return many of THIS client's leads to the house pipeline
 * in one click. Body: { auditIds: string[] }. Sets client_id = NULL.
 *
 * Only leads currently owned by THIS client are released (WHERE client_id = ?),
 * so the operator can never accidentally steal another client's leads, and the
 * count returned reflects what actually moved. Enrichment, audits, scores, and
 * notes all stay on the lead row untouched — only ownership flips. Owner + staff.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/clients/release-leads:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_av_enabled'))) return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) return NextResponse.json({ error: 'invalid client id' }, { status: 400 });

  let body: { auditIds?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const ids = Array.isArray(body.auditIds)
    ? body.auditIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).slice(0, 200)
    : [];
  if (ids.length === 0) return NextResponse.json({ error: 'no valid leads selected' }, { status: 400 });

  try {
    const db = getAvDb();
    const placeholders = ids.map(() => '?').join(',');
    // client_id = ? guard: only release leads this client actually owns.
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE leads SET client_id = NULL, last_activity_at = NOW()
         WHERE audit_id IN (${placeholders}) AND client_id = ? AND archived_at IS NULL`,
      [...ids, clientId]
    );
    return NextResponse.json({ ok: true, released: res.affectedRows ?? 0 });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
