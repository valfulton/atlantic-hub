/**
 * /api/admin/av/clients/[client_id]/pr-voice  (#88)
 *
 * GET  -> current { defaultVoice, posture } for this client
 * POST -> { defaultVoice?, posture? } — flips one or both without opening
 *         the full brief editor. Snapshots the brief so the change is
 *         reversible from the brief versions tab.
 *
 * Owner/staff only via guardAdminRequest. client_user role explicitly
 * rejected (defense in depth — the matcher already keeps them out of
 * /api/admin/*).
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getIntelConfig, setIntelConfig } from '@/lib/client/brief_store';
import type { IntelPosture, IntelVoice } from '@/lib/client/brief_store';

export const runtime = 'nodejs';
export const maxDuration = 15;

const VALID_VOICES: IntelVoice[] = ['client_voice', 'advisory', 'congratulatory'];
const VALID_POSTURES: IntelPosture[] = ['self_promotion', 'work_leads', 'both'];

export async function GET(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[client_id]/pr-voice:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client_id' }, { status: 400 });
  }
  try {
    const cfg = await getIntelConfig('av', clientId);
    return NextResponse.json({ ok: true, defaultVoice: cfg.defaultVoice, posture: cfg.posture });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[client_id]/pr-voice:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client_id' }, { status: 400 });
  }

  let body: { defaultVoice?: unknown; posture?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  // null is allowed (means "clear"). Anything other than null/undefined must be a valid enum.
  let nextVoice: IntelVoice | null | undefined = undefined;
  if ('defaultVoice' in body) {
    if (body.defaultVoice === null) nextVoice = null;
    else if (typeof body.defaultVoice === 'string' && VALID_VOICES.includes(body.defaultVoice as IntelVoice)) {
      nextVoice = body.defaultVoice as IntelVoice;
    } else {
      return NextResponse.json({ error: 'invalid defaultVoice' }, { status: 400 });
    }
  }

  let nextPosture: IntelPosture | null | undefined = undefined;
  if ('posture' in body) {
    if (body.posture === null) nextPosture = null;
    else if (typeof body.posture === 'string' && VALID_POSTURES.includes(body.posture as IntelPosture)) {
      nextPosture = body.posture as IntelPosture;
    } else {
      return NextResponse.json({ error: 'invalid posture' }, { status: 400 });
    }
  }

  if (nextVoice === undefined && nextPosture === undefined) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  try {
    const ok = await setIntelConfig({
      tenantId: 'av',
      clientId,
      defaultVoice: nextVoice,
      posture: nextPosture,
      changedBy: guard.actor.userId ? `user:${guard.actor.userId}` : 'operator'
    });
    if (!ok) return NextResponse.json({ error: 'save failed' }, { status: 500 });
    const cfg = await getIntelConfig('av', clientId);
    return NextResponse.json({ ok: true, defaultVoice: cfg.defaultVoice, posture: cfg.posture });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
