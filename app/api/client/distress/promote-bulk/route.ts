/**
 * POST /api/client/distress/promote-bulk  (#390, val 2026-06-03)
 *
 * Client-side companion to the operator bulk-promote endpoint. Adriana can
 * select multiple watchlist entities and add them all to her pipeline at
 * once. Scoped to her active brand.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';
import { promoteEntityToLead } from '@/lib/public_intel/promote';
import { watchlistForClient } from '@/lib/public_intel/distress_engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export async function POST(req: NextRequest) {
  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const user = await findClientUserById(actor.clientUserId);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);
  if (!clientId) return NextResponse.json({ error: 'no active brand' }, { status: 400 });

  let body: { entityKeys?: unknown } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const entityKeys = Array.isArray(body.entityKeys)
    ? body.entityKeys.filter((s): s is string => typeof s === 'string' && s.length > 0).slice(0, 50)
    : [];
  if (entityKeys.length === 0) return NextResponse.json({ error: 'entityKeys[] required' }, { status: 400 });

  const watchlist = await watchlistForClient(clientId, 200);
  const byKey = new Map(watchlist.map((r) => [r.entityKey, r]));

  const results: Array<{ entityKey: string; leadId?: number; auditId?: string; created?: boolean; error?: string }> = [];
  let created = 0;
  let alreadyExisted = 0;
  let errored = 0;

  for (const entityKey of entityKeys) {
    const row = byKey.get(entityKey);
    if (!row) { results.push({ entityKey, error: 'not on watchlist' }); errored++; continue; }
    try {
      const r = await promoteEntityToLead({
        clientId,
        entityKey: row.entityKey,
        entityLabel: row.entityLabel,
        regionCode: row.regionCode,
        score: row.score,
        signalKinds: row.contributingSignals.map((s) => s.signalKind),
        actorKind: 'client_user',
        actorId: actor.clientUserId
      });
      results.push({ entityKey, leadId: r.leadId, auditId: r.auditId, created: r.created });
      if (r.created) created++; else alreadyExisted++;
    } catch (e) {
      results.push({ entityKey, error: (e as Error).message.slice(0, 200) });
      errored++;
    }
  }

  return NextResponse.json({ ok: true, requested: entityKeys.length, created, alreadyExisted, errored, results });
}
