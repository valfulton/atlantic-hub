/**
 * Action-item notes (operator + client_user with case access).
 *   GET   — list notes chronologically
 *   POST  — append a new note ({ body })
 *
 * Client users only allowed if canClientUserAccessCase passes (collaborator
 * or primary case owner). Notes are append-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import {
  getActionItem,
  listActionItemNotes,
  addActionItemNote,
  canClientUserAccessCase
} from '@/lib/case/case_store';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { caseId: string; actionId: string };
}

/** Look up display name + role gate for whoever is calling. */
async function resolveAuthor(req: NextRequest, ctx: RouteContext): Promise<
  | { ok: true; actor: { userId: number; role: 'owner' | 'staff' | 'client_user' }; displayName: string | null }
  | { ok: false; status: number; error: string }
> {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_action_note:${ctx.params.actionId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return { ok: false, status: 401, error: 'unauthorized' };

  const caseId = parseInt(ctx.params.caseId, 10);
  const actionId = parseInt(ctx.params.actionId, 10);
  if (!Number.isFinite(actionId) || actionId <= 0) {
    return { ok: false, status: 400, error: 'bad action id' };
  }

  const action = await getActionItem(actionId);
  if (!action || action.caseId !== caseId) {
    return { ok: false, status: 404, error: 'action not found' };
  }

  let displayName: string | null = null;
  if (guard.actor.role === 'client_user') {
    const user = await findClientUserById(guard.actor.userId);
    if (!user) return { ok: false, status: 403, error: 'forbidden' };
    const primaryClientId = await activeBrandFor(guard.actor.userId, user.client_id ?? null);
    const allowed = await canClientUserAccessCase(guard.actor.userId, primaryClientId ?? 0, caseId);
    if (!allowed) return { ok: false, status: 403, error: 'forbidden' };
    displayName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.email || null;
  }

  return { ok: true, actor: { userId: guard.actor.userId, role: guard.actor.role }, displayName };
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const authed = await resolveAuthor(req, ctx);
  if (!authed.ok) return NextResponse.json({ ok: false, error: authed.error }, { status: authed.status });

  const actionId = parseInt(ctx.params.actionId, 10);
  const notes = await listActionItemNotes(actionId);
  return NextResponse.json({ ok: true, notes });
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const authed = await resolveAuthor(req, ctx);
  if (!authed.ok) return NextResponse.json({ ok: false, error: authed.error }, { status: authed.status });

  let body: { body?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'expected JSON body' }, { status: 400 }); }

  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return NextResponse.json({ ok: false, error: 'body required' }, { status: 400 });
  if (text.length > 5000) return NextResponse.json({ ok: false, error: 'too long (5000 char max)' }, { status: 400 });

  const actionId = parseInt(ctx.params.actionId, 10);
  const noteId = await addActionItemNote({
    actionId,
    body: text,
    authorRole: authed.actor.role,
    authorUserId: authed.actor.userId,
    authorDisplayName: authed.displayName
  });

  if (!noteId) return NextResponse.json({ ok: false, error: 'insert failed' }, { status: 500 });
  return NextResponse.json({ ok: true, noteId });
}
