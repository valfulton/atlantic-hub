/**
 * DELETE /api/admin/brand-kit/library/[id]
 *   Soft-archive a library item. Owner only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { archiveLibraryItem } from '@/lib/brand_kit/library';

export const runtime = 'nodejs';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/brand-kit/library/[id]:DELETE',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role !== 'owner') {
    return NextResponse.json({ error: 'forbidden -- owner only' }, { status: 403 });
  }

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  try {
    await archiveLibraryItem(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[brand-kit:library:archive]', (err as Error).message);
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}
