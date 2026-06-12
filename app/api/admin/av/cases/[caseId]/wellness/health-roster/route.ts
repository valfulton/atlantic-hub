/**
 * POST /api/admin/av/cases/[caseId]/wellness/health-roster  (val 2026-06-12, Phase 3)
 *
 * Add a row to the family_health_roster — doctor, medication, condition,
 * insurance carrier, pharmacy, etc. Used by Rebecca when she's at the parents'
 * house and finds a pill bottle or appointment card that needs logging.
 *
 * Body (required: category + label):
 *   {
 *     partyId?: number,
 *     category: 'primary_care' | 'specialist' | 'dentist' | 'pharmacy' |
 *               'insurance' | 'medicare' | 'medicaid' | 'medication' |
 *               'condition' | 'allergy',
 *     label: string,
 *     details?: string,
 *     contactName?: string,
 *     contactPhone?: string,
 *     contactAddress?: string,
 *     carrierNumber?: string,
 *     lastVisitDate?: 'YYYY-MM-DD',
 *     nextVisitDate?: 'YYYY-MM-DD',
 *     notes?: string
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { addHealthRosterEntry } from '@/lib/case/family_wellness';
import { getCase } from '@/lib/case/case_store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { caseId: string };
}

const CATEGORIES = [
  'primary_care', 'specialist', 'dentist', 'pharmacy',
  'insurance', 'medicare', 'medicaid', 'medication',
  'condition', 'allergy'
];

export async function POST(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_wellness_health_roster:${ctx.params.caseId}`,
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

  const category = typeof b.category === 'string' ? b.category : '';
  const label = typeof b.label === 'string' ? b.label.trim() : '';
  if (!CATEGORIES.includes(category)) {
    return NextResponse.json({ ok: false, error: 'invalid category' }, { status: 400 });
  }
  if (!label) {
    return NextResponse.json({ ok: false, error: 'label required' }, { status: 400 });
  }

  const rosterId = await addHealthRosterEntry({
    caseId,
    partyId: typeof b.partyId === 'number' && Number.isInteger(b.partyId) ? b.partyId : null,
    category,
    label,
    details: typeof b.details === 'string' ? b.details : null,
    contactName: typeof b.contactName === 'string' ? b.contactName : null,
    contactPhone: typeof b.contactPhone === 'string' ? b.contactPhone : null,
    contactAddress: typeof b.contactAddress === 'string' ? b.contactAddress : null,
    carrierNumber: typeof b.carrierNumber === 'string' ? b.carrierNumber : null,
    lastVisitDate: typeof b.lastVisitDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(b.lastVisitDate)
      ? b.lastVisitDate : null,
    nextVisitDate: typeof b.nextVisitDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(b.nextVisitDate)
      ? b.nextVisitDate : null,
    notes: typeof b.notes === 'string' ? b.notes : null,
    addedByUserId: guard.actor.userId ?? null
  });

  if (!rosterId) {
    return NextResponse.json({ ok: false, error: 'insert failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, rosterId });
}
