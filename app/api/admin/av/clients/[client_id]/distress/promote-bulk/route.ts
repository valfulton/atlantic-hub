/**
 * POST /api/admin/av/clients/[client_id]/distress/promote-bulk  (#390, val 2026-06-03)
 *
 * Body: { entityKeys: string[] }
 *
 * Promotes multiple watchlist entities into the leads pipeline in one call.
 * Each promotion runs through promoteEntityToLead (same dedup + audit trail
 * as the single-entity route). Returns per-entity outcomes so the UI can
 * show "9 added · 1 already in pipeline".
 *
 * No Hunter calls. No LLM calls. Just leads-table writes + cascade
 * attribution copied into audit_content.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { promoteEntityToLead } from '@/lib/public_intel/promote';
import { watchlistForClient } from '@/lib/public_intel/distress_engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/distress/promote-bulk:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: { entityKeys?: unknown } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const entityKeys = Array.isArray(body.entityKeys)
    ? body.entityKeys.filter((s): s is string => typeof s === 'string' && s.length > 0).slice(0, 50)
    : [];
  if (entityKeys.length === 0) return NextResponse.json({ error: 'entityKeys[] required' }, { status: 400 });

  // Pull the full current watchlist once so we can attach score + signals to each promotion.
  const watchlist = await watchlistForClient(clientId, 200);
  const byKey = new Map(watchlist.map((r) => [r.entityKey, r]));

  const results: Array<{ entityKey: string; leadId?: number; auditId?: string; created?: boolean; error?: string }> = [];
  let created = 0;
  let alreadyExisted = 0;
  let errored = 0;

  for (const entityKey of entityKeys) {
    const row = byKey.get(entityKey);
    if (!row) {
      results.push({ entityKey, error: 'not on watchlist' });
      errored++;
      continue;
    }
    try {
      const r = await promoteEntityToLead({
        clientId,
        entityKey: row.entityKey,
        entityLabel: row.entityLabel,
        regionCode: row.regionCode,
        score: row.score,
        signalKinds: row.contributingSignals.map((s) => s.signalKind),
        actorKind: 'operator',
        actorId: guard.actor.userId
      });
      results.push({ entityKey, leadId: r.leadId, auditId: r.auditId, created: r.created });
      if (r.created) created++;
      else alreadyExisted++;
    } catch (e) {
      results.push({ entityKey, error: (e as Error).message.slice(0, 200) });
      errored++;
    }
  }

  return NextResponse.json({
    ok: true,
    requested: entityKeys.length,
    created,
    alreadyExisted,
    errored,
    results
  });
}
