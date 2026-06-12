/**
 * POST /api/admin/av/cases/[caseId]/documents/[documentId]/approval
 * (val 2026-06-12, #613)
 *
 * Document approval workflow endpoint. Drives Shape 2 — Adriana approves,
 * client downloads.
 *
 * Who can call this:
 *   - Operator (owner / staff): any status transition. val can approve from
 *     the operator dashboard if she's drafting + reviewing herself, or roll
 *     back to draft.
 *   - client_user with case access (primary OR collaborator): can move docs
 *     between pending_review ↔ approved ↔ rejected. Cannot send to draft
 *     (that's an operator-only action — "take it back to edit").
 *
 * Body: { status: 'draft'|'pending_review'|'approved'|'rejected', note?: string }
 *
 * The note is required on 'rejected' (so Adriana tells val what's wrong) and
 * optional on 'approved' (e.g. "ready to sign 6/15").
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import {
  getDocument,
  setDocumentApprovalStatus,
  canClientUserAccessCase,
  type DocumentApprovalStatus
} from '@/lib/case/case_store';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';

export const runtime = 'nodejs';

interface RouteContext {
  params: { caseId: string; documentId: string };
}

const VALID_STATUSES: DocumentApprovalStatus[] = [
  'draft', 'pending_review', 'approved', 'rejected'
];

export async function POST(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_document_approve:${ctx.params.documentId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  const caseId = parseInt(ctx.params.caseId, 10);
  const documentId = parseInt(ctx.params.documentId, 10);
  if (!Number.isFinite(caseId) || caseId <= 0 ||
      !Number.isFinite(documentId) || documentId <= 0) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }

  let body: { status?: string; note?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'expected JSON body' }, { status: 400 }); }

  const status = body.status as DocumentApprovalStatus | undefined;
  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({
      ok: false,
      error: `status must be one of: ${VALID_STATUSES.join(', ')}`
    }, { status: 400 });
  }

  const note = (body.note ?? '').trim() || null;
  if (status === 'rejected' && !note) {
    return NextResponse.json({
      ok: false,
      error: 'a note explaining the rejection is required when rejecting a draft'
    }, { status: 400 });
  }

  const doc = await getDocument(documentId);
  if (!doc || doc.caseId !== caseId) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }

  // Access gate.
  let actorClientUserId: number | null = null;
  if (guard.actor.role === 'client_user') {
    // Collaborator / primary may approve, reject, or send back to pending.
    // They CANNOT send to draft — that's operator-only "take it back to edit".
    if (status === 'draft') {
      return NextResponse.json({
        ok: false,
        error: 'only the operator can roll a doc back to draft'
      }, { status: 403 });
    }
    const user = await findClientUserById(guard.actor.userId);
    if (!user) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    const primaryClientId = await activeBrandFor(guard.actor.userId, user.client_id ?? null);
    const allowed = await canClientUserAccessCase(
      guard.actor.userId, primaryClientId ?? 0, caseId
    );
    if (!allowed) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    actorClientUserId = guard.actor.userId;
  }

  const ok = await setDocumentApprovalStatus({
    documentId,
    status,
    actorClientUserId,
    note
  });
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'update failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    documentId,
    approvalStatus: status,
    approvalNote: note,
    approvedByUserId: status === 'approved' || status === 'rejected' ? actorClientUserId : null
  });
}
