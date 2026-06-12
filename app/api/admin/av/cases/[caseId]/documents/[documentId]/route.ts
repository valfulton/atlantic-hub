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
import { getDocument, deleteDocument, canClientUserAccessCase } from '@/lib/case/case_store';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';

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
