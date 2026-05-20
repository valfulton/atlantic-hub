/**
 * POST /api/admin/av/leads/[audit_id]/brand-kit/apply-library
 *
 * Apply a library logo to this lead's brand kit. Copies the logo
 * bytes + default settings into lead_brand_kits via the existing
 * upsert path; bumps the library row's use_count + last_used_at so
 * the picker re-sorts toward "most likely the right one."
 *
 * Body: { libraryItemId: number }
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { applyLibraryItemToLead } from '@/lib/brand_kit/library';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/brand-kit/apply-library',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }
  if (!UUID_RE.test(params.audit_id)) {
    return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const libraryItemId = Number(payload.libraryItemId);
  if (!Number.isFinite(libraryItemId) || libraryItemId <= 0) {
    return NextResponse.json({ error: 'libraryItemId required' }, { status: 400 });
  }

  const db = getAvDb();
  const [leadRows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
    [params.audit_id]
  );
  if (leadRows.length === 0) {
    return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  }

  try {
    const kit = await applyLibraryItemToLead({
      libraryItemId,
      leadId: leadRows[0].id,
      actorUserId: guard.actor.userId
    });
    return NextResponse.json({ ok: true, kit });
  } catch (err) {
    console.error('[brand-kit:apply-library]', (err as Error).message);
    return NextResponse.json(
      { error: 'server error', detail: (err as Error).message.slice(0, 300) },
      { status: 500 }
    );
  }
}
