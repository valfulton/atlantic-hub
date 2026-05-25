/**
 * POST /api/admin/social/calendar/important-dates
 *
 * Add a client important date (birthday / anniversary / busy season / launch /
 * one-off) that layers onto the Campaign Timeline grid. Owner + staff only.
 * Body: { label, kind?, tenant?, clientId?, recurMonth?, recurDay?, eventDate? }
 * Provide EITHER recurMonth+recurDay (annual) OR eventDate (one-off).
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { addImportantDate } from '@/lib/calendar/important_dates';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/social/calendar/important-dates:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label) return NextResponse.json({ error: 'label required' }, { status: 400 });

  const eventDate = typeof body.eventDate === 'string' && body.eventDate ? body.eventDate.slice(0, 10) : null;
  const recurMonth = Number.isFinite(Number(body.recurMonth)) ? Number(body.recurMonth) : null;
  const recurDay = Number.isFinite(Number(body.recurDay)) ? Number(body.recurDay) : null;

  if (!eventDate && (!recurMonth || !recurDay)) {
    return NextResponse.json({ error: 'provide eventDate, or recurMonth + recurDay' }, { status: 400 });
  }
  if (recurMonth != null && (recurMonth < 1 || recurMonth > 12)) {
    return NextResponse.json({ error: 'recurMonth must be 1-12' }, { status: 400 });
  }
  if (recurDay != null && (recurDay < 1 || recurDay > 31)) {
    return NextResponse.json({ error: 'recurDay must be 1-31' }, { status: 400 });
  }

  try {
    const id = await addImportantDate({
      tenant: typeof body.tenant === 'string' ? body.tenant : 'av',
      clientId: typeof body.clientId === 'number' && body.clientId > 0 ? body.clientId : null,
      label,
      kind: typeof body.kind === 'string' ? body.kind : 'date',
      eventDate,
      recurMonth: eventDate ? null : recurMonth,
      recurDay: eventDate ? null : recurDay,
      source: 'manual'
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
