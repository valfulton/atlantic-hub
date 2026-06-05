/**
 * POST /api/client/distress/move-brand  (#386, val 2026-06-05)
 *
 * Owner-only cross-brand move on the distress watchlist. Adriana owns CBB
 * + CLDA — when a CourtListener filing lands on CLDA but reads like a CBB
 * target, she clicks "Move to CBB" on the watchlist row and this endpoint
 * re-keys the entity row.
 *
 * Guard: caller MUST be the owner of BOTH the source AND the target brand.
 * "owner" comes from brand_members (multi-brand-accounts model). A rep on
 * one brand and viewer on the other gets a 403.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { isBrandOwner } from '@/lib/client/membership';
import { moveDistressEntity } from '@/lib/public_intel/move_brand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const user = await findClientUserById(actor.clientUserId);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { fromClientId?: unknown; toClientId?: unknown; entityKey?: unknown } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const fromClientId = Number(body.fromClientId);
  const toClientId = Number(body.toClientId);
  const entityKey = typeof body.entityKey === 'string' ? body.entityKey : '';
  if (!Number.isInteger(fromClientId) || fromClientId <= 0) {
    return NextResponse.json({ error: 'fromClientId required' }, { status: 400 });
  }
  if (!Number.isInteger(toClientId) || toClientId <= 0) {
    return NextResponse.json({ error: 'toClientId required' }, { status: 400 });
  }
  if (!entityKey) {
    return NextResponse.json({ error: 'entityKey required' }, { status: 400 });
  }

  // Authorization: owner of BOTH brands. A non-owner cannot retitle a signal
  // out of a brand they only see, and cannot deposit a signal into a brand
  // they only see — that would be cross-tenant pollution.
  const [ownsFrom, ownsTo] = await Promise.all([
    isBrandOwner(actor.clientUserId, fromClientId),
    isBrandOwner(actor.clientUserId, toClientId)
  ]);
  if (!ownsFrom || !ownsTo) {
    return NextResponse.json({
      error: 'forbidden',
      reason: 'You must own both brands to move a signal between them.'
    }, { status: 403 });
  }

  const result = await moveDistressEntity({ fromClientId, toClientId, entityKey });
  if (!result.ok) {
    const status = result.reason === 'source_not_found' ? 404
      : result.reason === 'same_brand' ? 400
      : 500;
    return NextResponse.json({ ok: false, reason: result.reason, detail: result.detail }, { status });
  }
  return NextResponse.json({ ok: true, mode: result.mode, toClientId: result.toClientId });
}
