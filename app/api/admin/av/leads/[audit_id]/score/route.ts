/**
 * POST /api/admin/av/leads/[audit_id]/score
 *
 * Owner / staff override -- forces an AI re-score of a specific lead.
 * Synchronously awaits the scoring run (unlike the fire-and-forget insert
 * path) so the operator sees the new score reflected when the response
 * returns and can refresh the detail page.
 *
 * Forbidden for client_user.
 *
 * Response:
 *   { ok: true, result: ScoreAndAuditResult } on success
 *   { ok: false, ... } on insufficient data / openai error / not found
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { scoreAndAuditLead } from '@/lib/ai/score_and_audit';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/score',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }
  if (!UUID_RE.test(params.audit_id)) {
    return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });
  }

  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
    [params.audit_id]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  }
  const leadId = rows[0].id;

  try {
    const result = await scoreAndAuditLead(leadId);
    if (!result) {
      return NextResponse.json(
        { ok: false, error: 'scoring_returned_null', detail: 'see system_events for the underlying failure' },
        { status: 502 }
      );
    }
    if (result.skipped) {
      return NextResponse.json(
        { ok: false, error: 'insufficient_data', skipReason: result.skipReason },
        { status: 422 }
      );
    }
    return NextResponse.json({ ok: true, leadId, result });
  } catch (err) {
    console.error('[av:lead:score]', (err as Error).message);
    return NextResponse.json(
      { error: 'score_run_failed', errorClass: (err as Error).name, message: (err as Error).message.slice(0, 300) },
      { status: 500 }
    );
  }
}
