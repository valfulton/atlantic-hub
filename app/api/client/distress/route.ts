/**
 * GET /api/client/distress  (#385, val 2026-06-03)
 *
 * Adriana's view of her own distress watchlist. Scoped strictly to the
 * client_id of her active brand (CBB or CLDA depending on the brand
 * switcher). Client-session guarded — no operator can hit this; no client
 * can hit another client's data.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';
import { watchlistForClient } from '@/lib/public_intel/distress_engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const user = await findClientUserById(actor.clientUserId);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Multi-brand: scope to the brand they're currently viewing.
  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);
  if (!clientId) return NextResponse.json({ ok: true, count: 0, rows: [] });

  const limit = Math.min(50, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '25', 10) || 25));
  const rows = await watchlistForClient(clientId, limit);
  return NextResponse.json({ ok: true, count: rows.length, rows });
}
