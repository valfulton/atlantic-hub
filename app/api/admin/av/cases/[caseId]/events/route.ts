/**
 * POST /api/admin/av/cases/[caseId]/events  (val 2026-06-11, Phase 2)
 *
 * Append an event to the case timeline.
 *
 * Body:
 *   {
 *     eventDate: 'YYYY-MM-DD',
 *     eventTitle: string,
 *     eventKind?: string,           // 'signed' | 'filed' | 'meeting' | etc.
 *     eventDetail?: string,
 *     source?: string,              // 'email_forward' | 'manual' | etc.
 *     sourceUri?: string
 *   }
 *
 * Operator-only. Auth via guardAdminRequest.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { appendEvent, getCase, canClientUserAccessCase } from '@/lib/case/case_store';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { caseId: string };
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_event:${ctx.params.caseId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  const caseId = parseInt(ctx.params.caseId, 10);
  if (!Number.isInteger(caseId) || caseId <= 0) {
    return NextResponse.json({ ok: false, error: 'bad case id' }, { status: 400 });
  }

  // Confirm the case exists before letting writes through.
  const existing = await getCase(caseId);
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'case not found' }, { status: 404 });
  }

  // (val 2026-06-15, #691) Family-side adds. Rebecca + parents + Adriana
  // can append to the timeline so they don't need val to log every call,
  // bank conversation, or document arrival. canClientUserAccessCase
  // covers brand-owner + case_collaborators + sibling_admin paths.
  // PATCH + DELETE on individual events stay operator-only (separate
  // route file) so destructive ops are gated.
  if (guard.actor.role === 'client_user') {
    const user = await findClientUserById(guard.actor.userId);
    if (!user) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }
    const primaryClientId = await activeBrandFor(guard.actor.userId, user.client_id ?? null);
    const allowed = await canClientUserAccessCase(
      guard.actor.userId, primaryClientId ?? 0, caseId
    );
    if (!allowed) {
      return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    }
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'body must be json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'body required' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const eventDate = typeof b.eventDate === 'string' ? b.eventDate : '';
  const eventTitle = typeof b.eventTitle === 'string' ? b.eventTitle.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}/.test(eventDate)) {
    return NextResponse.json({ ok: false, error: 'eventDate must be YYYY-MM-DD' }, { status: 400 });
  }
  if (!eventTitle) {
    return NextResponse.json({ ok: false, error: 'eventTitle required' }, { status: 400 });
  }

  const eventId = await appendEvent({
    caseId,
    eventDate,
    eventTitle,
    eventKind: typeof b.eventKind === 'string' ? b.eventKind : null,
    eventDetail: typeof b.eventDetail === 'string' ? b.eventDetail : null,
    source: typeof b.source === 'string' ? b.source : null,
    sourceUri: typeof b.sourceUri === 'string' ? b.sourceUri : null,
    createdByUserId: guard.actor.userId ?? null
  });

  if (!eventId) {
    return NextResponse.json({ ok: false, error: 'insert failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, eventId });
}
