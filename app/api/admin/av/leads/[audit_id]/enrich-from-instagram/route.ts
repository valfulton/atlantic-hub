/**
 * POST /api/admin/av/leads/[audit_id]/enrich-from-instagram   (#269)
 *
 * Per-lead Instagram enrich. Mirrors enrich-from-places: resolves the lead
 * from audit_id, calls lib/apify/discoverer.enrichLeadFromInstagram. Soft
 * failures (no handle, profile not found, missing Apify token) come back
 * 200 with ok=false + reason so the UI renders the reason inline.
 *
 * Body (optional): { handle?: string } — operator-supplied handle override
 * when our handle-resolution heuristics can't find one. Useful for NDVIP-like
 * cases where the website is a SPA and we couldn't scrape socials.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { enrichLeadFromInstagram } from '@/lib/apify/discoverer';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/enrich-from-instagram:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }
  if (!UUID_RE.test(params.audit_id)) {
    return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });
  }

  // Optional handle override — empty body is also valid (use auto-resolution).
  let handleOverride: string | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.handle === 'string' && body.handle.trim()) {
      handleOverride = body.handle.trim();
    }
  } catch { /* empty body OK */ }

  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
    [params.audit_id]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  }

  const result = await enrichLeadFromInstagram({
    leadId: rows[0].id,
    handleOverride,
    actorUserId: guard.actor.userId
  });
  return NextResponse.json(result);
}
