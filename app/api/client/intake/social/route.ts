/**
 * Client intake-form social-channels endpoints  (#45 Phase B)
 *
 *   GET  /api/client/intake/social?brand=<id>     -> list targets for the brand
 *   POST /api/client/intake/social?brand=<id>     -> add a target the client typed
 *
 * Auth is the share token in `x-intake-share-token` (NO session cookie).
 * Scope is resolved via resolveScopeFromRequest: single-brand tokens get one
 * client_id; owner-scoped tokens get whichever of their brands matches ?brand=.
 */
import { NextRequest, NextResponse } from 'next/server';
import { headers as nextHeaders } from 'next/headers';
import { resolveScopeFromRequest } from '@/lib/auth/intake-share-scope';
import { listTargetsForBrand, addSuggestedTarget } from '@/lib/social/targets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readRequestedBrand(req: NextRequest): number | null {
  const raw = req.nextUrl.searchParams.get('brand');
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET(req: NextRequest) {
  const scope = await resolveScopeFromRequest(nextHeaders(), readRequestedBrand(req));
  if (!scope) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const targets = await listTargetsForBrand(scope.clientId);
  return NextResponse.json({ ok: true, targets });
}

export async function POST(req: NextRequest) {
  const scope = await resolveScopeFromRequest(nextHeaders(), readRequestedBrand(req));
  if (!scope) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { url?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });

  const result = await addSuggestedTarget({
    tenantId: 'av',
    clientId: scope.clientId,
    url,
    source: 'client_intake'
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, note: result.note ?? 'failed' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, target: result.target, note: result.note ?? null });
}
