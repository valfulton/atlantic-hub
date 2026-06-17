/**
 * PATCH /api/admin/av/cases/[caseId]/notes/[noteId]  (val 2026-06-16, #710)
 *
 * Edit an existing case_note. Mirrors the access pattern of the POST
 * route:
 *
 *   - owner / staff: edit any note on the case
 *   - client_user:   only notes they authored themselves (matched by
 *                    author_user_id + author_role)
 *
 * Body shape:
 *   { body?: string, pinned?: boolean, audience?: NoteAudience }
 *
 * audience + pinned ignored for client_user (operator-only fields).
 *
 * The store layer's updateCaseNote() already accepts the partial patch;
 * we just enforce role-side guardrails here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import {
  getCaseNote,
  updateCaseNote,
  type NoteAudience
} from '@/lib/case/case_notes_store';
import { getCase, canClientUserAccessCase } from '@/lib/case/case_store';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { caseId: string; noteId: string };
}

const AUDIENCE_OK: NoteAudience[] = ['family', 'legal_team', 'operator_only'];

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_note:${ctx.params.caseId}:${ctx.params.noteId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  const caseId = parseInt(ctx.params.caseId, 10);
  const noteId = parseInt(ctx.params.noteId, 10);
  if (!Number.isInteger(caseId) || caseId <= 0
      || !Number.isInteger(noteId) || noteId <= 0) {
    return NextResponse.json({ ok: false, error: 'bad ids' }, { status: 400 });
  }

  const existing = await getCase(caseId);
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'case not found' }, { status: 404 });
  }

  const note = await getCaseNote(noteId);
  if (!note || note.caseId !== caseId) {
    return NextResponse.json({ ok: false, error: 'note not found' }, { status: 404 });
  }

  // Access gate — mirrors POST.
  if (guard.actor.role === 'client_user') {
    const user = await findClientUserById(guard.actor.userId);
    if (!user) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    const primaryClientId = await activeBrandFor(guard.actor.userId, user.client_id ?? null);
    const allowed = await canClientUserAccessCase(
      guard.actor.userId, primaryClientId ?? 0, caseId
    );
    if (!allowed) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    // client_user may only edit their own notes (matched by author_user_id + role).
    if (note.authorRole !== 'client_user' || note.authorUserId !== guard.actor.userId) {
      return NextResponse.json({ ok: false, error: 'not your note' }, { status: 403 });
    }
  }
  // operator (owner/staff) — implicit allow on any note in their tenant.

  // Parse + validate patch fields.
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'body must be json' }, { status: 400 }); }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'body required' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const patch: { body?: string; audience?: NoteAudience; pinned?: boolean } = {};
  if (typeof b.body === 'string') {
    const trimmed = b.body.trim();
    if (!trimmed) {
      return NextResponse.json({ ok: false, error: 'note body required' }, { status: 400 });
    }
    patch.body = trimmed;
  }
  // audience + pinned: operator only. Silent ignore for client_user keeps the
  // UI simple — the textarea on the family side just submits body.
  if (guard.actor.role !== 'client_user') {
    if (typeof b.audience === 'string'
        && (AUDIENCE_OK as string[]).includes(b.audience)) {
      patch.audience = b.audience as NoteAudience;
    }
    if (typeof b.pinned === 'boolean') {
      patch.pinned = b.pinned;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'nothing to update' }, { status: 400 });
  }

  const ok = await updateCaseNote(noteId, patch);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'update failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
