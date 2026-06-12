/**
 * POST /api/admin/av/cases/[caseId]/documents/[documentId]/reindex
 *
 * Re-scan a previously-uploaded PDF and rebuild its {sectionKey: pageNumber}
 * map. Used when:
 *   - a doc was uploaded before the indexer existed (one-time backfill)
 *   - operator changes the doc_kind to one we deep-link
 *   - we improve the regex and want existing docs to pick up the change
 *
 * Operator-only. Synchronous response: returns the rebuilt map so the UI can
 * immediately render section anchors without a page refresh.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getHotStorage } from '@/lib/storage/provider';
import { getDocument, setDocumentSectionIndex } from '@/lib/case/case_store';
import { buildSectionIndex } from '@/lib/case/pdf_section_index';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface RouteContext {
  params: { caseId: string; documentId: string };
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_document_reindex:${ctx.params.documentId}`,
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

  const doc = await getDocument(documentId);
  if (!doc || doc.caseId !== caseId) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }
  if (doc.mimeType !== 'application/pdf') {
    return NextResponse.json({ ok: false, error: 'only PDFs can be re-indexed' }, { status: 400 });
  }

  const bytes = await getHotStorage('case-documents').getBytes(doc.storageUri);
  if (!bytes) {
    return NextResponse.json({ ok: false, error: 'file bytes missing from storage' }, { status: 404 });
  }

  try {
    const buf = Buffer.from(bytes);
    const idx = await buildSectionIndex(buf);
    if (idx.unreadable) {
      const detail = idx.errorMessage
        ? `${idx.errorClass ?? 'Error'}: ${idx.errorMessage}`
        : null;
      return NextResponse.json({
        ok: false,
        error: detail ? `parse failed — ${detail}` : 'PDF could not be parsed (no detail returned)',
        errorClass: idx.errorClass ?? null,
        errorMessage: idx.errorMessage ?? null
      }, { status: 422 });
    }
    await setDocumentSectionIndex(documentId, idx.pages);
    return NextResponse.json({
      ok: true,
      sectionCount: Object.keys(idx.pages).length,
      pageCount: idx.pageCount,
      pages: idx.pages
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: 'index build failed',
      errorClass: (err as Error).name
    }, { status: 500 });
  }
}
