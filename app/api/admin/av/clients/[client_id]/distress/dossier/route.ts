/**
 * GET /api/admin/av/clients/[client_id]/distress/dossier (val 2026-06-07)
 *
 * Operator-only intel dossier for a single watchlist entity. Returns the
 * full raw payload of every public_intel_record we have on the entity,
 * plus the watchlist score row, signals, and any promoted lead row(s).
 *
 * Query params:
 *   - entity_key  (required) — the entity to load
 *   - entity_label (optional) — used to JSON-search related records by name
 *   - max         (optional) — record cap, default 100, max 500
 *
 * Auth: admin only. client_user role is explicitly blocked — this surface
 * shows raw source payloads + signal mechanics, which we never expose to
 * the client side.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { loadDossierForEntity } from '@/lib/public_intel/dossier';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { client_id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/distress/dossier:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const entityKey = searchParams.get('entity_key');
  if (!entityKey || entityKey.trim().length === 0) {
    return NextResponse.json({ error: 'entity_key required' }, { status: 400 });
  }
  const entityLabel = searchParams.get('entity_label');
  const maxParam = searchParams.get('max');
  const maxRecords = maxParam ? Number.parseInt(maxParam, 10) : undefined;

  const dossier = await loadDossierForEntity({
    clientId,
    entityKey: entityKey.trim(),
    entityLabel: entityLabel?.trim() || null,
    maxRecords: Number.isFinite(maxRecords) ? maxRecords : undefined
  });

  return NextResponse.json(dossier);
}
