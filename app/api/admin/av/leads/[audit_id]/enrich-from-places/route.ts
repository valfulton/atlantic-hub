/**
 * POST /api/admin/av/leads/[audit_id]/enrich-from-places   (#268)
 *
 * Per-lead Google Places enrich. Resolves the lead from audit_id, calls
 * lib/google_places/discoverer.enrichLeadFromPlaces. Soft failures come back
 * 200 with ok=false + reason so the UI renders the reason inline.
 *
 * Owner + staff only. AV-tab-gated.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { enrichLeadFromPlaces } from '@/lib/google_places/discoverer';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/enrich-from-places:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }
  if (!UUID_RE.test(params.audit_id)) {
    return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });
  }

  // Resolve audit_id → lead id. The lib helper works in lead-id space so
  // every discovery / enrichment path keys off the same id.
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
    [params.audit_id]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  }

  const result = await enrichLeadFromPlaces({
    leadId: rows[0].id,
    actorUserId: guard.actor.userId
  });
  // Soft failures (no match, ambiguous, API key missing) → 200 with ok=false.
  // The UI surfaces `result.reason` inline. Only wire-level failures use 4xx.
  return NextResponse.json(result);
}
