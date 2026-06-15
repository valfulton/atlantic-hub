/**
 * PATCH /api/admin/av/cases/[caseId]/findings/[findingId]/severity  (val 2026-06-15)
 *
 * Operator-only — update the severity of a single LLM-produced finding.
 * Built so val can re-categorize findings from the hub UI instead of
 * editing the DB by hand (the page-109 + page-116 Johnson findings were
 * the original prompt for this).
 *
 * No tone fanfare. POST { severity } with one of the four ENUM values.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export const runtime = 'nodejs';

interface RouteContext {
  params: { caseId: string; findingId: string };
}

const ALLOWED = ['urgent', 'high', 'normal', 'info'] as const;
type Sev = (typeof ALLOWED)[number];

interface FindingRow extends RowDataPacket {
  case_id: number;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_finding_severity:${ctx.params.findingId}`,
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

  let body: { severity?: string } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const sev = (body.severity || '').toLowerCase() as Sev;
  if (!ALLOWED.includes(sev)) {
    return NextResponse.json(
      { ok: false, error: `severity must be one of ${ALLOWED.join(', ')}` },
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

  // (#673) Severity change counts as curation — protect from re-scan wipe.
  await db.execute<ResultSetHeader>(
    `UPDATE case_document_findings SET severity = ?, is_curated = 1 WHERE finding_id = ?`,
    [sev, findingId]
  );

  return NextResponse.json({ ok: true, findingId, severity: sev });
}
