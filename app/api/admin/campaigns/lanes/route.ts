/**
 * /api/admin/campaigns/lanes
 *
 * GET   -> list narrative lanes (?includeInactive=1 for management view).
 * POST  -> create a lane { name, description?, accent?, cadenceHint?, tenant? }.
 * PATCH -> update/toggle a lane { id, ...fields }.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { listLanes, createLane, updateLane, setLineState, type NarrativeLineState } from '@/lib/campaigns/store';

export const runtime = 'nodejs';

const VALID_STATES: NarrativeLineState[] = ['candidate', 'active', 'reinforcing', 'retiring'];

/** Pull the narrative-line intelligence fields out of a request body.
 *  A key is only included when present, so PATCH stays a partial update. */
function lineFieldsFromBody(body: Record<string, unknown>) {
  const str = (k: string): string | null | undefined =>
    body[k] === undefined ? undefined : (typeof body[k] === 'string' ? (body[k] as string) : null);
  const strList = (k: string): string[] | undefined =>
    body[k] === undefined ? undefined : (Array.isArray(body[k]) ? (body[k] as unknown[]).map((x) => String(x)) : []);
  return {
    thesis: str('thesis'),
    audience: str('audience'),
    emotionalDriver: str('emotionalDriver'),
    authorityAngle: str('authorityAngle'),
    seasonality: str('seasonality'),
    conversionSignal: str('conversionSignal'),
    proofPoints: strList('proofPoints'),
    bestChannels: strList('bestChannels'),
    doSay: strList('doSay'),
    dontSay: strList('dontSay')
  };
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/lanes:GET', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const url = new URL(req.url);
  const tenant = url.searchParams.get('tenant') || 'av';
  const includeInactive = url.searchParams.get('includeInactive') === '1';
  try {
    const lanes = await listLanes(tenant, { includeInactive });
    return NextResponse.json({ ok: true, lanes });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/lanes:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  try {
    const id = await createLane({
      tenantId: typeof body.tenant === 'string' ? body.tenant : 'av',
      name,
      description: typeof body.description === 'string' ? body.description : null,
      accent: typeof body.accent === 'string' ? body.accent : null,
      cadenceHint: typeof body.cadenceHint === 'string' ? body.cadenceHint : null,
      // New lines default to 'candidate' in the store unless an explicit state is sent.
      state: typeof body.state === 'string' && VALID_STATES.includes(body.state as NarrativeLineState)
        ? (body.state as NarrativeLineState) : undefined,
      ...lineFieldsFromBody(body)
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/campaigns/lanes:PATCH', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const id = typeof body.id === 'number' ? body.id : Number.parseInt(String(body.id), 10);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    // A lifecycle change goes through setLineState, which enforces the 2-4
    // active cap. If it refuses (cap hit), surface the friendly message and stop.
    if (typeof body.state === 'string') {
      if (!VALID_STATES.includes(body.state as NarrativeLineState)) {
        return NextResponse.json({ error: 'invalid state' }, { status: 400 });
      }
      const tenant = typeof body.tenant === 'string' ? body.tenant : 'av';
      const result = await setLineState(id, body.state as NarrativeLineState, tenant);
      if (!result.ok) {
        return NextResponse.json({ error: result.message, activeCount: result.activeCount }, { status: 409 });
      }
    }
    await updateLane(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      description: body.description === undefined ? undefined : (typeof body.description === 'string' ? body.description : null),
      accent: typeof body.accent === 'string' ? body.accent : undefined,
      cadenceHint: typeof body.cadenceHint === 'string' ? body.cadenceHint : undefined,
      isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
      ...lineFieldsFromBody(body)
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
