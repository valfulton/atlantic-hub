/**
 * Single case document endpoint.
 *   GET    streams the file bytes from hot storage (private, no-store).
 *   DELETE removes the row (bytes orphan in blob storage — fine for now,
 *          a separate purge cron can sweep later).
 *
 * Owner + staff only — same gate as the upload route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getHotStorage } from '@/lib/storage/provider';
import {
  getDocument,
  deleteDocument,
  canClientUserAccessCase,
  updateDocumentKind,
  setDocumentSectionIndex
} from '@/lib/case/case_store';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';
import { buildSectionIndex } from '@/lib/case/pdf_section_index';

const ALLOWED_KINDS = new Set([
  'trust', 'deed', 'will', 'poa', 'medical_directive',
  'financial_statement', 'court_filing', 'correspondence', 'photo', 'other'
]);
const INDEXABLE_KINDS = new Set(['trust', 'will', 'poa', 'medical_directive']);

export const runtime = 'nodejs';

interface RouteContext {
  params: { caseId: string; documentId: string };
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_document_get:${ctx.params.documentId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  const caseId = parseInt(ctx.params.caseId, 10);
  const documentId = parseInt(ctx.params.documentId, 10);
  if (!Number.isFinite(caseId) || caseId <= 0 || !Number.isFinite(documentId) || documentId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const doc = await getDocument(documentId);
  if (!doc || doc.caseId !== caseId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Read-only access for client_users: the byte stream is what the SectionText
  // hyperlink opens in a new tab. Rebecca (primary) or Adriana (collaborator)
  // must be able to follow §6.G(2) into the PDF. We honor the same access
  // rule used by the case detail page (primary OR approved collaborator).
  if (guard.actor.role === 'client_user') {
    const user = await findClientUserById(guard.actor.userId);
    if (!user) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const primaryClientId = await activeBrandFor(guard.actor.userId, user.client_id ?? null);
    const allowed = await canClientUserAccessCase(guard.actor.userId, primaryClientId ?? 0, caseId);
    if (!allowed) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }

  const bytes = await getHotStorage('case-documents').getBytes(doc.storageUri);
  if (!bytes) {
    return NextResponse.json({ error: 'file not found in storage' }, { status: 404 });
  }

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'content-type': doc.mimeType || 'application/octet-stream',
      'content-disposition': `inline; filename="${doc.documentName.replace(/[^a-zA-Z0-9._ -]/g, '_')}"`,
      'cache-control': 'private, no-store'
    }
  });
}

/** PATCH — update document metadata. Today: just the kind. The body is
 *  {documentKind: 'trust' | 'will' | ...} or null to clear.
 *
 *  When the new kind is one we deep-link (trust/will/poa/medical_directive)
 *  AND the file is a PDF, we synchronously rebuild the § index so the
 *  operator sees the Re-index status update in the same round trip — saves a
 *  second click on the "I forgot to pick a kind" path.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_document_patch:${ctx.params.documentId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const caseId = parseInt(ctx.params.caseId, 10);
  const documentId = parseInt(ctx.params.documentId, 10);
  if (!Number.isFinite(documentId) || documentId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }

  let body: { documentKind?: string | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'expected JSON body' }, { status: 400 }); }

  const newKind = body.documentKind === null ? null : (body.documentKind || '').trim() || null;
  if (newKind != null && !ALLOWED_KINDS.has(newKind)) {
    return NextResponse.json({ ok: false, error: 'unknown documentKind' }, { status: 400 });
  }

  const doc = await getDocument(documentId);
  if (!doc || doc.caseId !== caseId) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }

  const ok = await updateDocumentKind(documentId, newKind);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'update failed' }, { status: 500 });
  }

  // Synchronous § index rebuild on the happy path — operator gets immediate
  // confirmation. Async branch on the upload route is for fresh uploads where
  // we don't want to block the response on a slow PDF.
  let sectionCount: number | null = null;
  let indexErr: string | null = null;
  if (newKind && INDEXABLE_KINDS.has(newKind) && doc.mimeType === 'application/pdf') {
    try {
      const bytes = await getHotStorage('case-documents').getBytes(doc.storageUri);
      if (!bytes) {
        indexErr = 'file bytes missing from storage';
      } else {
        const idx = await buildSectionIndex(Buffer.from(bytes));
        if (idx.unreadable) {
          // Surface the actual pdfjs error so we can diagnose. Encryption is
          // ONE cause; others: worker resolution, ESM import, font fetch.
          const detail = idx.errorMessage
            ? `${idx.errorClass ?? 'Error'}: ${idx.errorMessage}`
            : 'no detail';
          indexErr = `parse failed — ${detail}`;
        } else {
          await setDocumentSectionIndex(documentId, idx.pages);
          sectionCount = Object.keys(idx.pages).length;
        }
      }
    } catch (err) {
      indexErr = (err as Error).message || 'index build failed';
    }
  }

  return NextResponse.json({
    ok: true,
    documentKind: newKind,
    sectionCount,
    indexErr
  });
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_document_delete:${ctx.params.documentId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const caseId = parseInt(ctx.params.caseId, 10);
  const documentId = parseInt(ctx.params.documentId, 10);
  if (!Number.isFinite(documentId) || documentId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const doc = await getDocument(documentId);
  if (!doc || doc.caseId !== caseId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const ok = await deleteDocument(documentId);
  if (!ok) {
    return NextResponse.json({ error: 'delete failed' }, { status: 500 });
  }
  // Note: blob bytes intentionally orphaned. A separate purge cron will
  // sweep blobs with no matching document_id later. Trying to delete the
  // blob synchronously here would either need to block on the network or
  // risk dropping the row but failing the blob delete (no atomic op).
  return NextResponse.json({ ok: true });
}
