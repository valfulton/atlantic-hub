/**
 * POST /api/admin/av/cases/[caseId]/wellness/appointments  (val 2026-06-12, Phase 3)
 *
 * Schedule a care appointment for a tracked party. scheduledAt is the only
 * required field beyond caseId.
 *
 * Body:
 *   {
 *     partyId?: number,
 *     appointmentKind?: string,          // 'follow_up' | 'specialist' | 'lab' | etc.
 *     scheduledAt: string,               // ISO timestamp or 'YYYY-MM-DD HH:mm'
 *     providerName?: string,
 *     location?: string,
 *     transportResponsibleUserId?: number,
 *     notes?: string
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { addAppointment } from '@/lib/case/family_wellness';
import { getCase } from '@/lib/case/case_store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { caseId: string };
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_wellness_appointment:${ctx.params.caseId}`,
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

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'body must be json' }, { status: 400 }); }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'body required' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const scheduledAt = typeof b.scheduledAt === 'string' ? b.scheduledAt.trim() : '';
  if (!scheduledAt || !/^\d{4}-\d{2}-\d{2}/.test(scheduledAt)) {
    return NextResponse.json({ ok: false, error: 'scheduledAt required (YYYY-MM-DD or ISO timestamp)' }, { status: 400 });
  }

  const appointmentId = await addAppointment({
    caseId,
    partyId: typeof b.partyId === 'number' && Number.isInteger(b.partyId) ? b.partyId : null,
    appointmentKind: typeof b.appointmentKind === 'string' ? b.appointmentKind : null,
    scheduledAt,
    providerName: typeof b.providerName === 'string' ? b.providerName : null,
    location: typeof b.location === 'string' ? b.location : null,
    transportResponsibleUserId: typeof b.transportResponsibleUserId === 'number'
      && Number.isInteger(b.transportResponsibleUserId)
      ? b.transportResponsibleUserId
      : null,
    notes: typeof b.notes === 'string' ? b.notes : null
  });

  if (!appointmentId) {
    return NextResponse.json({ ok: false, error: 'insert failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, appointmentId });
}
