/**
 * PUT /api/admin/av/cases/[caseId]/documents/[documentId]/content
 *   (val 2026-06-15, #676 Tier B)
 *
 * Operator-only — save edited markdown content back to a case document.
 * Only markdown documents are editable in v1 (the Option A–E drafts that
 * prompted the build). docx/pdf round-trip would need mammoth + docx-js
 * fidelity work, deferred to Tier C.
 *
 * Behavior:
 *   - guardAdminRequest enforces operator (client_user role 403'd)
 *   - IDOR — doc must belong to the case in the URL
 *   - Mime type allowlist — markdown only
 *   - Overwrites the existing storage URI in place (Netlify Blobs .set is
 *     destructive by key, so the doc keeps its document_id + storage_uri,
 *     and any §-index / approvals / findings keep pointing at the same row)
 *   - Updates size_bytes so the doc-vault row shows the new size
 *
 * Body: { content: string } — UTF-8 markdown source
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { getHotStorage } from '@/lib/storage/provider';
import { getDocument, canClientUserAccessCase, loadFullCase } from '@/lib/case/case_store';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';
import { resolveCaseViewerRole, canEditCaseDocuments } from '@/lib/case/case_collaborators';
import type { ResultSetHeader } from 'mysql2/promise';

export const runtime = 'nodejs';

interface RouteContext {
  params: { caseId: string; documentId: string };
}

// Same allowlist the viewer uses to decide what to render as markdown.
function isMarkdownDoc(mime: string | null, name: string): boolean {
  const mt = (mime || '').toLowerCase();
  if (mt === 'text/markdown' || mt === 'text/x-markdown') return true;
  return /\.(md|markdown)$/i.test(name);
}

const MAX_BYTES = 2 * 1024 * 1024; // 2MB — way larger than any draft we hand-author

export async function PUT(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_document_content:${ctx.params.documentId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  const caseId = parseInt(ctx.params.caseId, 10);
  const documentId = parseInt(ctx.params.documentId, 10);
  if (!Number.isFinite(caseId) || caseId <= 0 ||
      !Number.isFinite(documentId) || documentId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }

  // (val 2026-06-15) Family-side editing — Adriana likes the viewer, asked
  // for edit too. Allow client_user when they can access this case AND their
  // case-scoped role is on the edit allowlist (account_rep / professional).
  // Parents (lifetime beneficiaries) are READ-ONLY so they can't accidentally
  // damage the case file. (#679 v3)
  if (guard.actor.role === 'client_user') {
    const user = await findClientUserById(guard.actor.userId);
    if (!user) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    const primaryClientId = await activeBrandFor(guard.actor.userId, user.client_id ?? null);
    const allowed = await canClientUserAccessCase(
      guard.actor.userId, primaryClientId ?? 0, caseId
    );
    if (!allowed) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

    // (#679) Per-role edit gate — UI hides Edit for parents, but this is
    // the hard server-side stop in case anyone hits the API directly.
    const full = await loadFullCase(caseId);
    const viewerRole = await resolveCaseViewerRole(
      guard.actor.userId, caseId, full?.case?.clientId ?? null
    );
    if (!canEditCaseDocuments(viewerRole)) {
      return NextResponse.json(
        { ok: false, error: 'this account is read-only on case documents' },
        { status: 403 }
      );
    }
  }

  let body: { content?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'expected JSON body' }, { status: 400 }); }

  if (typeof body.content !== 'string') {
    return NextResponse.json({ ok: false, error: 'content must be a string' }, { status: 400 });
  }
  const content = body.content;
  const newBuf = Buffer.from(content, 'utf-8');
  if (newBuf.byteLength > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'content exceeds 2MB' }, { status: 413 });
  }

  // Fetch + IDOR + mime check.
  const doc = await getDocument(documentId);
  if (!doc || doc.caseId !== caseId) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }
  if (!isMarkdownDoc(doc.mimeType, doc.documentName)) {
    return NextResponse.json(
      { ok: false, error: 'only markdown documents are editable in this version' },
      { status: 415 }
    );
  }

  // Overwrite the bytes in place. Same key, so document_id + storage_uri
  // stay stable and every dependent record (approvals, findings, sections)
  // keeps pointing at the live document.
  try {
    await getHotStorage('case-documents').put(
      doc.storageUri,
      newBuf,
      doc.mimeType || 'text/markdown'
    );
  } catch (err) {
    console.error('case-document save failed', err);
    return NextResponse.json({ ok: false, error: 'storage write failed' }, { status: 500 });
  }

  // Update size_bytes + uploaded_at so the doc-vault row reflects the new
  // version. We deliberately do NOT touch document_kind, approval_status,
  // or any §-index — an edit is a content tweak, not a re-classification.
  try {
    const db = getAvDb();
    await db.execute<ResultSetHeader>(
      `UPDATE case_documents
          SET size_bytes = ?,
              uploaded_at = CURRENT_TIMESTAMP
        WHERE document_id = ?`,
      [newBuf.byteLength, documentId]
    );
  } catch (err) {
    console.error('case-document row update failed', err);
    // Bytes are saved; row update is bookkeeping. Don't fail the save.
  }

  return NextResponse.json({
    ok: true,
    documentId,
    sizeBytes: newBuf.byteLength
  });
}
