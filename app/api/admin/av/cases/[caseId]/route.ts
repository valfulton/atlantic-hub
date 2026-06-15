/**
 * PATCH /api/admin/av/cases/[caseId]   (val 2026-06-15, #682)
 *
 * Operator inline-edit on the case row itself. Today scope: caseName +
 * caseSynopsis. Replaces the SQL workflow val was using to tweak the
 * paragraph at the top of the case page.
 *
 * Operator-only — case copy is the foundational prose every viewer reads,
 * so this stays gated on guardAdminRequest (no client_user).
 *
 * Body: { caseName?: string; caseSynopsis?: string | null }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getCase, updateCase } from '@/lib/case/case_store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { caseId: string };
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case:${ctx.params.caseId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  // Operator-only — client_user role is blocked even if they have case access.
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const caseId = parseInt(ctx.params.caseId, 10);
  if (!Number.isInteger(caseId) || caseId <= 0) {
    return NextResponse.json({ ok: false, error: 'bad case id' }, { status: 400 });
  }

  const existing = await getCase(caseId);
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'case not found' }, { status: 404 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'body must be json' }, { status: 400 }); }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'body required' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const patch: { caseName?: string; caseSynopsis?: string | null } = {};
  if (typeof b.caseName === 'string') {
    const trimmed = b.caseName.trim();
    if (!trimmed) {
      return NextResponse.json({ ok: false, error: 'caseName cannot be blank' }, { status: 400 });
    }
    patch.caseName = trimmed;
  }
  if ('caseSynopsis' in b) {
    if (b.caseSynopsis === null) {
      patch.caseSynopsis = null;
    } else if (typeof b.caseSynopsis === 'string') {
      // Empty string → NULL so the placeholder ("No synopsis yet") comes back.
      const trimmed = b.caseSynopsis.trim();
      patch.caseSynopsis = trimmed || null;
    } else {
      return NextResponse.json({ ok: false, error: 'caseSynopsis must be string or null' }, { status: 400 });
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'no editable fields in body' }, { status: 400 });
  }

  const ok = await updateCase(caseId, patch);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'update failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
