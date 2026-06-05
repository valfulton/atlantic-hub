/**
 * GET /api/admin/av/vertical-packs  (#428)
 *
 * Lists every vertical pack the platform knows about. No client_id needed —
 * NewClientForm uses this to populate the pack picker BEFORE the client exists.
 * The per-client pack apply endpoint (POST /api/admin/av/clients/[id]/vertical-pack)
 * still does the actual application; this one is just the catalog.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { listPacks } from '@/lib/public_intel/vertical_packs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/vertical-packs:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  return NextResponse.json({
    ok: true,
    packs: listPacks().map((p) => ({
      id: p.id,
      displayName: p.displayName,
      shortPositioning: p.shortPositioning
    }))
  });
}
