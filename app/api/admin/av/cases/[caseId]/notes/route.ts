/**
 * POST /api/admin/av/cases/[caseId]/notes  (val 2026-06-15, #699)
 *
 * Add a case-level note. Accepts operator (owner/staff) AND client_user
 * (case-member collaborators). Audience defaults to 'family'; only
 * operator can set 'operator_only'. Edit/archive are on the per-note
 * route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { addCaseNote, type NoteAudience } from '@/lib/case/case_notes_store';
import { getCase, canClientUserAccessCase } from '@/lib/case/case_store';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { caseId: string };
}

const AUDIENCE_OK: NoteAudience[] = ['family', 'legal_team', 'operator_only'];

export async function POST(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_note:${ctx.params.caseId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  const caseId = parseInt(ctx.params.caseId, 10);
  if (!Number.isInteger(caseId) || caseId <= 0) {
    return NextResponse.json({ ok: false, error: 'bad case id' }, { status: 400 });
  }

  const existing = await getCase(caseId);
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'case not found' }, { status: 404 });
  }

  // Client_user access gate (matches the events + acknowledge routes).
  let authorRole: 'owner' | 'staff' | 'client_user';
  let authorDisplayName: string | null = null;
  if (guard.actor.role === 'client_user') {
    const user = await findClientUserById(guard.actor.userId);
    if (!user) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    const primaryClientId = await activeBrandFor(guard.actor.userId, user.client_id ?? null);
    const allowed = await canClientUserAccessCase(
      guard.actor.userId, primaryClientId ?? 0, caseId
    );
    if (!allowed) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    authorRole = 'client_user';
    authorDisplayName = user.display_name ?? null;
  } else {
    authorRole = guard.actor.role === 'owner' ? 'owner' : 'staff';
    authorDisplayName = guard.actor.displayName ?? null;
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'body must be json' }, { status: 400 }); }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'body required' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const text = typeof b.body === 'string' ? b.body.trim() : '';
  if (!text) {
    return NextResponse.json({ ok: false, error: 'note body required' }, { status: 400 });
  }

  // Audience: client_user always lands in 'family'. Operator can pick.
  let audience: NoteAudience = 'family';
  if (authorRole !== 'client_user' && typeof b.audience === 'string'
      && (AUDIENCE_OK as string[]).includes(b.audience)) {
    audience = b.audience as NoteAudience;
  }

  const pinned = authorRole !== 'client_user' && b.pinned === true;

  const noteId = await addCaseNote({
    caseId,
    body: text,
    authorUserId: guard.actor.userId ?? null,
    authorRole,
    authorDisplayName,
    audience,
    pinned,
    source: 'manual'
  });

  if (!noteId) {
    return NextResponse.json({ ok: false, error: 'insert failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, noteId });
}
