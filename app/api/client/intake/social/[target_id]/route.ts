/**
 * POST /api/client/intake/social/[target_id]?brand=<id>  (#45 Phase B)
 *
 * Client confirms or rejects a suggested social target. Auth via the share
 * token in `x-intake-share-token`. Brand scope enforced: the target's
 * client_id must match the scope the token authorizes.
 *
 * Body: { action: 'confirm' | 'reject' }
 */
import { NextRequest, NextResponse } from 'next/server';
import { headers as nextHeaders } from 'next/headers';
import { resolveScopeFromRequest } from '@/lib/auth/intake-share-scope';
import { confirmTarget, rejectTarget, getTargetById } from '@/lib/social/targets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readRequestedBrand(req: NextRequest): number | null {
  const raw = req.nextUrl.searchParams.get('brand');
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { target_id: string } }
) {
  const scope = await resolveScopeFromRequest(nextHeaders(), readRequestedBrand(req));
  if (!scope) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const targetId = Number.parseInt(params.target_id, 10);
  if (!Number.isFinite(targetId) || targetId <= 0) {
    return NextResponse.json({ error: 'invalid target id' }, { status: 400 });
  }
  const target = await getTargetById(targetId);
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (target.clientId !== scope.clientId) {
    return NextResponse.json({ error: 'wrong brand' }, { status: 403 });
  }

  let body: { action?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const action = body.action;
  if (action === 'confirm') {
    const updated = await confirmTarget(targetId);
    return NextResponse.json({ ok: true, target: updated });
  }
  if (action === 'reject') {
    const updated = await rejectTarget(targetId);
    return NextResponse.json({ ok: true, target: updated });
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
