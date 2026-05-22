/**
 * POST /api/admin/pr/opportunities/[id]/dismiss
 *
 * Dismiss an opportunity / idea by moving it to status 'passed'. Used by the
 * desk to clear stale auto-suggestions (e.g. old pre-voice-fix "client win"
 * rows) so they stop polluting the ranked suggestion stream.
 *
 * No migration: 'passed' is already a valid pr_opportunities.status value from
 * schema 025 (see SYSTEM_CONSTITUTION.md section 3 -- PR opportunity lifecycle
 * new -> drafted -> submitted -> won / passed).
 *
 * Owner + staff only. Guarded by the existing /api/admin/* matcher +
 * guardAdminRequest.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/pr/opportunities/[id]/dismiss:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const oppId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(oppId) || oppId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { id: number; status: string; suggested: number; matched_lead_id: number | null })[]>(
      `SELECT id, status, suggested, matched_lead_id FROM pr_opportunities WHERE id = ? LIMIT 1`,
      [oppId]
    );
    const opp = rows[0];
    if (!opp) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    if (opp.status === 'passed') {
      return NextResponse.json({ ok: true, id: oppId, status: 'passed', alreadyPassed: true });
    }

    await db.execute<ResultSetHeader>(
      `UPDATE pr_opportunities SET status = 'passed', updated_at = NOW() WHERE id = ?`,
      [oppId]
    );

    await logEvent({
      eventType: 'pr.opportunity.dismissed',
      leadId: opp.matched_lead_id,
      userId: guard.actor.userId,
      source: 'pr_desk',
      payload: { opportunity_id: oppId, from_status: opp.status, suggested: Number(opp.suggested) === 1 }
    });

    return NextResponse.json({ ok: true, id: oppId, status: 'passed' });
  } catch (err) {
    console.error('[pr:opportunities:dismiss]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
