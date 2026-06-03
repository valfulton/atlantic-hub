/**
 * POST /api/admin/av/clients/[client_id]/public-intel/run   (#369, val 2026-06-02)
 *
 * Body: { sourceKind: PublicIntelKind }
 *
 * Loads the source row, looks up the adapter, runs it scoped to this client.
 * Returns the RunResult so the UI can show "fetched N, cached M, errored 0."
 *
 * Owner / staff only. Capped at 60s — adapters that need longer should chunk
 * or move to the HostGator worker (see Worker_Deployment_HostGator.md).
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAdapter } from '@/lib/public_intel/registry';
import { listSourcesForClient, upsertSource } from '@/lib/public_intel/store';
import type { PublicIntelKind } from '@/lib/public_intel/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/public-intel/run:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: { sourceKind?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const kind = String(body.sourceKind ?? '') as PublicIntelKind;
  const entry = getAdapter(kind);
  if (!entry) return NextResponse.json({ error: `unknown adapter "${kind}"` }, { status: 400 });
  if (!entry.available) {
    return NextResponse.json(
      { error: 'not_available', reason: `${entry.adapter.displayName} is not yet implemented — only registered as a stub.` },
      { status: 400 }
    );
  }

  // Find or auto-provision the source row for this (client, kind).
  const sources = await listSourcesForClient(clientId);
  let source = sources.find((s) => s.sourceKind === kind) ?? null;
  if (!source) {
    const id = await upsertSource({ clientId, sourceKind: kind, enabled: true, config: null });
    if (!id) return NextResponse.json({ error: 'source provision failed' }, { status: 500 });
    const refreshed = await listSourcesForClient(clientId);
    source = refreshed.find((s) => s.sourceKind === kind) ?? null;
  }
  if (!source) return NextResponse.json({ error: 'source not found post-provision' }, { status: 500 });

  try {
    const result = await entry.adapter.run({ source, clientId });
    return NextResponse.json({ kind, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'adapter threw', errorClass: (err as Error).name, detail: (err as Error).message.slice(0, 280) },
      { status: 500 }
    );
  }
}
