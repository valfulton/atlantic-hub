/**
 * /api/admin/av/clients/[client_id]/pr-sources  (#214)
 *
 * Per-client PR discovery sources -- list + add. Each row binds an RSS
 * feed to a specific client so the runner picks them up under that
 * client's scope.
 *
 * GET   -> list all sources for this client
 * POST  -> add a new RSS source { url, label? }
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import {
  listSourcesForClient,
  addRssSourceForClient
} from '@/lib/pr/client_sources';
import { DEFAULT_TENANT } from '@/lib/pr/types';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/pr-sources:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }
  try {
    const sources = await listSourcesForClient(clientId);
    return NextResponse.json({ ok: true, sources });
  } catch (err) {
    return NextResponse.json({ error: 'list_failed', message: (err as Error).message.slice(0, 300) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/pr-sources:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: { url?: unknown; label?: unknown } = {};
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return NextResponse.json({ error: 'url_required' }, { status: 400 });
  if (!/^https?:\/\/.+/i.test(url)) {
    return NextResponse.json({ error: 'invalid_url', message: 'URL must start with http:// or https://' }, { status: 400 });
  }
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 255) : null;

  try {
    const src = await addRssSourceForClient({
      clientId,
      tenantId: DEFAULT_TENANT,
      url,
      label
    });
    return NextResponse.json({ ok: true, source: src });
  } catch (err) {
    return NextResponse.json({ error: 'create_failed', message: (err as Error).message.slice(0, 300) }, { status: 500 });
  }
}
