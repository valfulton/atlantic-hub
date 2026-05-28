/**
 * POST /api/client/active-brand   { clientId }
 *
 * Multi-brand (#101): an owner who spans brands switches which brand they're
 * viewing. Validates that the logged-in person is actually a member of the
 * requested brand, then sets the `ah_active_brand` cookie. Client pages read it
 * via activeBrandFor(). The switcher posts here, then refreshes.
 *
 * Auth: client-portal (x-ah-client-user-id from middleware).
 */
import { NextRequest, NextResponse } from 'next/server';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { roleForBrand } from '@/lib/client/membership';
import { ACTIVE_BRAND_COOKIE } from '@/lib/client/active-brand';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { clientId?: unknown } = {};
  try { body = (await req.json()) as { clientId?: unknown }; }
  catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }

  const clientId = Number.parseInt(String(body.clientId), 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid clientId' }, { status: 400 });
  }

  // Only let them switch to a brand they actually belong to.
  const role = await roleForBrand(actor.clientUserId, clientId);
  if (!role) return NextResponse.json({ error: 'not a member of that brand' }, { status: 403 });

  const res = NextResponse.json({ ok: true, clientId, role });
  res.cookies.set({
    name: ACTIVE_BRAND_COOKIE,
    value: String(clientId),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60
  });
  return res;
}
