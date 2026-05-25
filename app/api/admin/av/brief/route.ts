/**
 * GET  /api/admin/av/brief?tenantId=av&clientId=123
 * POST /api/admin/av/brief   body: { tenantId, clientId|null, payload }
 *
 * Read/write the editable Creative Brief for a scope:
 *   - a client    -> clientId = clients.client_id
 *   - a house brand -> clientId omitted/null  (AV / EBW / HH for that tenant)
 *
 * Owner + staff only. The brief payload uses the canonical 6-question keys
 * (same shape as client_users.intake_payload) and feeds the thesis + PR prompts
 * via lib/client/brief_store.getBriefForPrompt().
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getBriefPayload, saveBriefPayload, getBriefForPrompt, listBriefVersions, restoreBriefVersion, type BriefPayload } from '@/lib/client/brief_store';

export const runtime = 'nodejs';
export const maxDuration = 30;

const KNOWN_TENANTS = new Set(['av', 'ebw', 'hh']);

function parseClientId(raw: unknown): number | null {
  if (raw == null || raw === '' || raw === 'null') return null;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/brief', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_av_enabled'))) return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });

  const url = new URL(req.url);
  const tenantId = (url.searchParams.get('tenantId') || 'av').toLowerCase();
  if (!KNOWN_TENANTS.has(tenantId)) return NextResponse.json({ error: 'unknown tenant' }, { status: 400 });
  const clientId = parseClientId(url.searchParams.get('clientId'));

  // History view: list restore points for this scope.
  if (url.searchParams.get('history')) {
    try {
      const versions = await listBriefVersions(tenantId, clientId);
      return NextResponse.json({ ok: true, tenantId, clientId, versions });
    } catch (err) {
      return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
    }
  }

  try {
    const [payload, prompt] = await Promise.all([
      getBriefPayload(tenantId, clientId),
      getBriefForPrompt({ tenantId, clientId })
    ]);
    return NextResponse.json({
      ok: true,
      tenantId,
      clientId,
      brandName: prompt.brandName,
      grounded: prompt.grounded,
      payload: payload ?? {},
      promptBlock: prompt.block
    });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/brief:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_av_enabled'))) return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });

  let body: { tenantId?: unknown; clientId?: unknown; payload?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const tenantId = (typeof body.tenantId === 'string' ? body.tenantId : 'av').toLowerCase();
  if (!KNOWN_TENANTS.has(tenantId)) return NextResponse.json({ error: 'unknown tenant' }, { status: 400 });
  const clientId = parseClientId(body.clientId);
  const changedBy = (guard.actor as { email?: string }).email ?? null;

  // Restore a prior version (restore point).
  if ((body as { action?: unknown }).action === 'restore') {
    const versionId = Number.parseInt(String((body as { versionId?: unknown }).versionId ?? ''), 10);
    if (!Number.isFinite(versionId) || versionId <= 0) {
      return NextResponse.json({ error: 'valid versionId required' }, { status: 400 });
    }
    try {
      const ok = await restoreBriefVersion(tenantId, clientId, versionId, changedBy);
      if (!ok) return NextResponse.json({ error: 'restore failed' }, { status: 500 });
      const [payload, prompt] = await Promise.all([
        getBriefPayload(tenantId, clientId),
        getBriefForPrompt({ tenantId, clientId })
      ]);
      return NextResponse.json({ ok: true, tenantId, clientId, payload: payload ?? {}, brandName: prompt.brandName, grounded: prompt.grounded });
    } catch (err) {
      return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
    }
  }

  if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
    return NextResponse.json({ error: 'payload must be an object' }, { status: 400 });
  }

  try {
    const ok = await saveBriefPayload(tenantId, clientId, body.payload as BriefPayload, { changedBy, source: 'operator' });
    if (!ok) return NextResponse.json({ error: 'save failed' }, { status: 500 });
    const prompt = await getBriefForPrompt({ tenantId, clientId });
    return NextResponse.json({ ok: true, tenantId, clientId, brandName: prompt.brandName, grounded: prompt.grounded });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
