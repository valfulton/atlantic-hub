/**
 * PATCH /api/admin/av/cases/[caseId]/findings/[findingId]/content  (#670, val 2026-06-15)
 *
 * Edit the human-readable content of a finding — quote, note, section, page,
 * oddity type. Operator-only. Lets val + Adriana refine wording before the
 * finding surfaces to the family.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { updateFindingContent, type FindingEditInput } from '@/lib/case/document_findings_store';
import type { RowDataPacket } from 'mysql2/promise';

export const runtime = 'nodejs';

interface RouteContext {
  params: { caseId: string; findingId: string };
}

interface FindingRow extends RowDataPacket {
  case_id: number;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_finding_content:${ctx.params.findingId}`,
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

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body */ }

  // Allow only the editable fields through. Drop anything else silently.
  const input: FindingEditInput = {};
  if ('quote' in body) input.quote = body.quote == null ? null : String(body.quote).slice(0, 4000);
  if ('llmNote' in body) input.llmNote = body.llmNote == null ? null : String(body.llmNote).slice(0, 4000);
  if ('sectionKey' in body) input.sectionKey = body.sectionKey == null ? null : String(body.sectionKey).slice(0, 64);
  if ('pageNumber' in body) {
    const n = Number(body.pageNumber);
    input.pageNumber = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
  if ('oddityType' in body) input.oddityType = body.oddityType == null ? null : String(body.oddityType).slice(0, 64);

  // IDOR — confirm the finding belongs to the case in the URL.
  const db = getAvDb();
  const [rows] = await db.execute<FindingRow[]>(
    `SELECT case_id FROM case_document_findings WHERE finding_id = ? LIMIT 1`,
    [findingId]
  );
  if (rows.length === 0 || rows[0].case_id !== caseId) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }

  const ok = await updateFindingContent(findingId, input);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'update failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, findingId });
}
