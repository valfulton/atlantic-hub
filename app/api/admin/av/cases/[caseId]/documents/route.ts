/**
 * Case documents collection.
 *   POST   (multipart: file, documentName?, documentKind?, notes?) — upload to this case.
 *   GET                                                  — JSON list of documents.
 *
 * Owner + staff only — case files are sensitive (trust docs, deeds, account
 * statements, IDs). Bytes live in hot storage (Netlify Blobs, store
 * 'case-documents'); the row in case_documents holds the blob key + label +
 * mime + size.
 *
 * Mirrors the employee-documents pattern (#119) so we get the same
 * deterministic key scheme + same private-cache headers when bytes are served.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getHotStorage } from '@/lib/storage/provider';
import { attachDocument, listDocuments, getCase, setDocumentSectionIndex } from '@/lib/case/case_store';
import { buildSectionIndex } from '@/lib/case/pdf_section_index';

const INDEXABLE_KINDS = new Set(['trust', 'will', 'poa', 'medical_directive']);

export const runtime = 'nodejs';
export const maxDuration = 30;

interface RouteContext {
  params: { caseId: string };
}

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — trust PDFs + property reports tend to be bigger than employee paperwork

export async function POST(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_document_upload:${ctx.params.caseId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const caseId = parseInt(ctx.params.caseId, 10);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return NextResponse.json({ error: 'invalid case id' }, { status: 400 });
  }
  const existing = await getCase(caseId);
  if (!existing) {
    return NextResponse.json({ error: 'case not found' }, { status: 404 });
  }

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: 'expected multipart form data' }, { status: 400 }); }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing "file" field' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `file too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 });
  }

  // Optional metadata
  const documentName = (typeof form.get('documentName') === 'string' && (form.get('documentName') as string).trim())
    ? (form.get('documentName') as string).trim()
    : (file.name || 'Case document');
  const documentKind = (typeof form.get('documentKind') === 'string' && (form.get('documentKind') as string).trim())
    ? (form.get('documentKind') as string).trim()
    : null;
  const notes = (typeof form.get('notes') === 'string' && (form.get('notes') as string).trim())
    ? (form.get('notes') as string).trim()
    : null;

  // (val 2026-06-12, #613/#614) Optional approval status + action attachment.
  // Default: 'approved' — preserves the old behavior for direct case-vault
  // uploads (trust PDFs, deeds, property reports — no review needed). When val
  // is uploading a DRAFT that needs Adriana's sign-off, the form sends
  // approvalStatus='draft' OR 'pending_review' AND optionally attachedToActionId
  // so the doc lands scoped to a specific action item (e.g. Cecilia options).
  const approvalStatusRaw = (form.get('approvalStatus') as string | null)?.trim() || 'approved';
  const approvalStatus: 'draft' | 'pending_review' | 'approved' | 'rejected' =
    approvalStatusRaw === 'draft' || approvalStatusRaw === 'pending_review' ||
    approvalStatusRaw === 'approved' || approvalStatusRaw === 'rejected'
      ? approvalStatusRaw
      : 'approved';
  const actionIdRaw = (form.get('attachedToActionId') as string | null)?.trim();
  const attachedToActionId = actionIdRaw && /^\d+$/.test(actionIdRaw)
    ? parseInt(actionIdRaw, 10)
    : null;

  const safeName = (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const blobKey = `case/${caseId}/${Date.now()}-${safeName}`;

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    await getHotStorage('case-documents').put(blobKey, buf, file.type || 'application/octet-stream');
    const documentId = await attachDocument({
      caseId,
      documentName,
      documentKind,
      storageUri: blobKey,
      mimeType: file.type || null,
      sizeBytes: file.size,
      uploadedByUserId: guard.actor.userId ?? null,
      notes,
      approvalStatus,
      attachedToActionId
    });
    if (!documentId) {
      return NextResponse.json({ error: 'database write failed (file is in storage, row missing)' }, { status: 500 });
    }

    // Auto-index § sections if this is a legal doc we know how to deep-link.
    // We DON'T block the response on this — if the scan is slow or fails, the
    // upload still succeeds. Operator can hit "Re-index" if needed.
    if (documentKind && INDEXABLE_KINDS.has(documentKind) && file.type === 'application/pdf') {
      buildSectionIndex(buf)
        .then((idx) => {
          if (!idx.unreadable) {
            return setDocumentSectionIndex(documentId, idx.pages);
          }
        })
        .catch((err) => console.error('section-index build failed', err));
    }

    return NextResponse.json({ ok: true, documentId, documentName });
  } catch (err) {
    return NextResponse.json({ error: 'upload failed', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_documents_list:${ctx.params.caseId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const caseId = parseInt(ctx.params.caseId, 10);
  if (!Number.isFinite(caseId) || caseId <= 0) {
    return NextResponse.json({ error: 'invalid case id' }, { status: 400 });
  }

  const kindFilter = req.nextUrl.searchParams.get('kind') ?? undefined;
  const documents = await listDocuments(caseId, kindFilter || undefined);
  return NextResponse.json({ ok: true, documents });
}
