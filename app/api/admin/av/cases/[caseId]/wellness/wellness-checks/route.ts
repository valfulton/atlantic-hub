/**
 * POST /api/admin/av/cases/[caseId]/wellness/wellness-checks  (val 2026-06-12, Phase 3)
 *
 * Log a wellness check after a visit — cognition, mood, physical, unusual
 * contacts, concerns. This is the form Rebecca fills out after she leaves
 * her parents' house and wants to record what she observed.
 *
 * Body:
 *   {
 *     partyObservedId?: number,
 *     observedAt: string,                // ISO timestamp; defaults to now if blank
 *     observationKind?: string,          // 'in_person_visit' | 'phone_check' | 'video_call'
 *     cognitionNote?: string,
 *     moodNote?: string,
 *     physicalNote?: string,
 *     unusualContactsNote?: string,      // e.g. "Cecilia came by twice this week"
 *     concerns?: string,
 *     positiveObservations?: string
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { addWellnessCheck } from '@/lib/case/family_wellness';
import { getCase } from '@/lib/case/case_store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { caseId: string };
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_wellness_check:${ctx.params.caseId}`,
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

  // Default observedAt to now if not provided.
  const observedAt = typeof b.observedAt === 'string' && b.observedAt.trim()
    ? b.observedAt.trim()
    : new Date().toISOString().slice(0, 19).replace('T', ' ');

  const checkId = await addWellnessCheck({
    caseId,
    partyObservedId: typeof b.partyObservedId === 'number' && Number.isInteger(b.partyObservedId)
      ? b.partyObservedId : null,
    observedAt,
    observedByUserId: guard.actor.userId,
    observationKind: typeof b.observationKind === 'string' ? b.observationKind : null,
    cognitionNote: typeof b.cognitionNote === 'string' ? b.cognitionNote : null,
    moodNote: typeof b.moodNote === 'string' ? b.moodNote : null,
    physicalNote: typeof b.physicalNote === 'string' ? b.physicalNote : null,
    unusualContactsNote: typeof b.unusualContactsNote === 'string' ? b.unusualContactsNote : null,
    concerns: typeof b.concerns === 'string' ? b.concerns : null,
    positiveObservations: typeof b.positiveObservations === 'string' ? b.positiveObservations : null
  });

  if (!checkId) {
    return NextResponse.json({ ok: false, error: 'insert failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, checkId });
}
