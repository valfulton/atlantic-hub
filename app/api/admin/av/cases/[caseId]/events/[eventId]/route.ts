/**
 * PATCH / DELETE /api/admin/av/cases/[caseId]/events/[eventId]
 *   (val 2026-06-15, #682)
 *
 * Operator inline-edit / delete on case_events timeline entries. Mirrors
 * the action-items pattern from #632. Schema columns on case_events:
 *   event_date · event_kind · event_title · event_detail · source · source_uri
 * NO visibility column on case_events (only case_action_items + findings).
 *
 * Operator-only — see the case PATCH route for the rationale (case-level
 * content shouldn't be editable by client_user roles).
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getCase, updateEvent, deleteEvent } from '@/lib/case/case_store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { caseId: string; eventId: string };
}

function parseIds(ctx: RouteContext): { caseId: number; eventId: number } | null {
  const caseId = parseInt(ctx.params.caseId, 10);
  const eventId = parseInt(ctx.params.eventId, 10);
  if (!Number.isInteger(caseId) || caseId <= 0) return null;
  if (!Number.isInteger(eventId) || eventId <= 0) return null;
  return { caseId, eventId };
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_event:${ctx.params.eventId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const ids = parseIds(ctx);
  if (!ids) return NextResponse.json({ ok: false, error: 'bad id' }, { status: 400 });

  const existing = await getCase(ids.caseId);
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

  const patch: Parameters<typeof updateEvent>[2] = {};

  if (typeof b.eventDate === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}/.test(b.eventDate)) {
      return NextResponse.json({ ok: false, error: 'eventDate must be YYYY-MM-DD' }, { status: 400 });
    }
    patch.eventDate = b.eventDate.slice(0, 10);
  }
  if (typeof b.eventTitle === 'string') {
    const trimmed = b.eventTitle.trim();
    if (!trimmed) {
      return NextResponse.json({ ok: false, error: 'eventTitle cannot be blank' }, { status: 400 });
    }
    patch.eventTitle = trimmed;
  }
  if ('eventKind' in b) {
    patch.eventKind = typeof b.eventKind === 'string' ? (b.eventKind.trim() || null) : null;
  }
  if ('eventDetail' in b) {
    patch.eventDetail = typeof b.eventDetail === 'string' ? (b.eventDetail.trim() || null) : null;
  }
  if ('source' in b) {
    patch.source = typeof b.source === 'string' ? (b.source.trim() || null) : null;
  }
  if ('sourceUri' in b) {
    patch.sourceUri = typeof b.sourceUri === 'string' ? (b.sourceUri.trim() || null) : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'no editable fields in body' }, { status: 400 });
  }

  const ok = await updateEvent(ids.eventId, ids.caseId, patch);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'update failed (event not found or no change)' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_event:${ctx.params.eventId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const ids = parseIds(ctx);
  if (!ids) return NextResponse.json({ ok: false, error: 'bad id' }, { status: 400 });

  const ok = await deleteEvent(ids.eventId, ids.caseId);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'event not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
