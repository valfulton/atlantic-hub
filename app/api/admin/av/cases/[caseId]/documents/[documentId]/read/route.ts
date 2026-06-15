/**
 * POST /api/admin/av/cases/[caseId]/documents/[documentId]/read  (#666, val 2026-06-15)
 *
 * Run the LLM document reader against an uploaded PDF. Operator-only.
 *
 * Synchronous: blocks until the LLM call returns. The default model (gpt-4o)
 * typically responds in ~10–25s for a 30-page trust; we set maxDuration 90
 * to absorb spikes. Findings are stored in case_document_findings (re-runs
 * replace, never append). Response includes the parsed findings + cost so
 * the UI can render immediately without a re-fetch.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getDocument } from '@/lib/case/case_store';
import { readCaseDocument } from '@/lib/case/document_reader';

export const runtime = 'nodejs';
export const maxDuration = 90;

interface RouteContext {
  params: { caseId: string; documentId: string };
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_document_read:${ctx.params.documentId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const caseId = parseInt(ctx.params.caseId, 10);
  const documentId = parseInt(ctx.params.documentId, 10);
  if (!Number.isFinite(documentId) || documentId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid document id' }, { status: 400 });
  }

  // IDOR guard — confirm the document belongs to the case in the URL.
  const doc = await getDocument(documentId);
  if (!doc || doc.caseId !== caseId) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }

  const result = await readCaseDocument(documentId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || 'read failed' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    findingCount: result.findings.length,
    pageCount: result.pageCount,
    modelId: result.modelId,
    costMicrocents: result.costMicrocents,
    cacheSource: result.cacheSource,
    findings: result.findings
  });
}
