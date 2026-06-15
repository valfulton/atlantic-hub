/**
 * PATCH /api/admin/av/cases/[caseId]/findings/[findingId]/visibility  (val 2026-06-15, #669)
 *
 * Operator-only — flip a finding between operator_only and family_visible.
 * family_visible findings surface on /client/cases/[caseId] for Rebecca,
 * the parents, and Adriana via FamilyFindingsPanel.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { updateFindingVisibility, type FindingVisibility } from '@/lib/case/document_findings_store';
import type { RowDataPacket } from 'mysql2/promise';

export const runtime = 'nodejs';

interface RouteContext {
  params: { caseId: string; findingId: string };
}

interface FindingRow extends RowDataPacket {
  case_id: number;
}

const ALLOWED: FindingVisibility[] = ['operator_only', 'family_visible'];

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_finding_visibility:${ctx.params.findingId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const caseId = parseInt(ctx.params.caseId, 10);
  const findingId = parseInt(ctx.params.findingId, 10);
  if (!Number.isFinite(findingId) || findingId <= 0 || !Number.isFinite(caseId) || caseId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }

  let body: { visibility?: string } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const vis = (body.visibility || '') as FindingVisibility;
  if (!ALLOWED.includes(vis)) {
    return NextResponse.json(
      { ok: false, error: `visibility must be one of ${ALLOWED.join(', ')}` },
      { status: 400 }
    );
  }

  // IDOR — confirm the finding belongs to the case in the URL.
  const db = getAvDb();
  const [rows] = await db.execute<FindingRow[]>(
    `SELECT case_id FROM case_document_findings WHERE finding_id = ? LIMIT 1`,
    [findingId]
  );
  if (rows.length === 0 || rows[0].case_id !== caseId) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }

  const ok = await updateFindingVisibility(findingId, vis);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'update failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, findingId, visibility: vis });
}
