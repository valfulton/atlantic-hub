/**
 * GET /api/admin/av/leads/[audit_id]/social-drafts
 *
 * Returns the social-post drafts already generated for this lead so the
 * Commercials tab (and future surfaces) can let the operator pick one as
 * a commercial prompt without spending another LLM call.
 *
 * Owner + staff only.
 *
 * Response: { ok, drafts: [{ id, platform, variant, body, charCount, createdAt, status, commercialAssetId }] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DraftRow extends RowDataPacket {
  id: number;
  platform: 'linkedin' | 'twitter' | 'instagram' | 'facebook' | 'threads' | 'tiktok' | 'other';
  variant: string | null;
  body_text: string;
  char_count: number | null;
  status: 'active' | 'used_for_commercial' | 'published' | 'archived';
  commercial_asset_id: number | null;
  created_at: string;
}

export async function GET(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/social-drafts',
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

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 50));
  const platform = url.searchParams.get('platform'); // optional filter
  const includeArchived = url.searchParams.get('includeArchived') === '1';

  try {
    const db = getAvDb();
    const [leadRows] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
      [params.audit_id]
    );
    if (leadRows.length === 0) {
      return NextResponse.json({ error: 'lead not found' }, { status: 404 });
    }
    const leadId = leadRows[0].id;

    const where: string[] = ['lead_id = ?'];
    const values: unknown[] = [leadId];
    if (!includeArchived) {
      where.push("status != 'archived'");
    }
    if (platform) {
      where.push('platform = ?');
      values.push(platform);
    }

    // `limit` is clamped to an int 1..200 above; inline it. mysql2 + HostGator
    // throws ER_WRONG_ARGUMENTS on a prepared `LIMIT ?` (this was the 500).
    const [rows] = await db.execute<DraftRow[]>(
      `SELECT id, platform, variant, body_text, char_count, status, commercial_asset_id, created_at
       FROM lead_social_drafts
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      values
    );

    return NextResponse.json({
      ok: true,
      leadId,
      drafts: rows.map((r) => ({
        id: r.id,
        platform: r.platform,
        variant: r.variant,
        body: r.body_text,
        charCount: r.char_count,
        status: r.status,
        commercialAssetId: r.commercial_asset_id,
        createdAt: r.created_at
      }))
    });
  } catch (err) {
    // If the table is missing (schema 018 not yet applied), return an empty
    // list so the UI degrades gracefully rather than 500-ing.
    const msg = (err as Error).message || '';
    if (msg.includes("Table") && msg.includes("doesn't exist")) {
      return NextResponse.json({ ok: true, drafts: [], schemaPending: true });
    }
    console.error('[av:social-drafts:list]', msg);
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}
