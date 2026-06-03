/**
 * /api/admin/av/clients/[client_id]/public-intel/sources  (#369, val 2026-06-02)
 *
 * GET — list every registered adapter (available + planned) merged with this
 *       client's source rows. Front-end uses this to render the picker.
 * PUT — upsert one source (enable/disable + config). Body:
 *         { sourceKind: PublicIntelKind, enabled: boolean, config?: object }
 *
 * Owner / staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { listAdapters, getAdapter } from '@/lib/public_intel/registry';
import { listSourcesForClient, upsertSource } from '@/lib/public_intel/store';
import type { PublicIntelKind } from '@/lib/public_intel/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/public-intel/sources:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  const adapters = listAdapters();
  const sources = await listSourcesForClient(clientId);
  const byKind = new Map(sources.map((s) => [s.sourceKind, s]));

  const merged = adapters.map(({ adapter, available }) => {
    const src = byKind.get(adapter.kind) ?? null;
    return {
      kind: adapter.kind,
      displayName: adapter.displayName,
      description: adapter.description,
      requiresKey: adapter.requiresKey,
      costNote: adapter.costNote,
      bestFor: adapter.bestFor,
      available,
      source: src
        ? {
            sourceId: src.sourceId,
            enabled: src.enabled,
            config: src.config,
            lastRunAt: src.lastRunAt,
            lastRunStatus: src.lastRunStatus,
            lastRunDetail: src.lastRunDetail
          }
        : null
    };
  });

  return NextResponse.json({ ok: true, clientId, adapters: merged });
}

export async function PUT(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/public-intel/sources:PUT',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: { sourceKind?: unknown; enabled?: unknown; config?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const kind = String(body.sourceKind ?? '') as PublicIntelKind;
  const entry = getAdapter(kind);
  if (!entry) return NextResponse.json({ error: `unknown adapter "${kind}"` }, { status: 400 });

  // Adapter validates its own config.
  const config =
    body.config && typeof body.config === 'object' && !Array.isArray(body.config)
      ? (body.config as Record<string, unknown>)
      : null;
  const valError = entry.adapter.validateConfig(config);
  if (valError) {
    return NextResponse.json({ error: 'invalid config', reason: valError }, { status: 400 });
  }

  const enabled = body.enabled !== false;
  const ok = await upsertSource({ clientId, sourceKind: kind, enabled, config });
  if (!ok) return NextResponse.json({ error: 'upsert failed' }, { status: 500 });

  return NextResponse.json({ ok: true, kind, enabled, config });
}
