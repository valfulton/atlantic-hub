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
import { getDocument, deleteDocument } from '@/lib/case/case_store';

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
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const caseId = parseInt(ctx.params.caseId, 10);
  const documentId = parseInt(ctx.params.documentId, 10);
  if (!Number.isFinite(caseId) || caseId <= 0 || !Number.isFinite(documentId) || documentId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const doc = await getDocument(documentId);
  if (!doc || doc.caseId !== caseId) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
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
