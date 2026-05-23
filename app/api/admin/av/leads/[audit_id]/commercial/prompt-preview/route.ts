/**
 * GET /api/admin/av/leads/[audit_id]/commercial/prompt-preview
 *
 * Returns the auto-built commercial prompt the system would send to the
 * AI engine for this lead at the given assetType + duration + logoSpace.
 * Does NOT generate anything; does NOT cost API credits; does NOT mutate
 * any rows. Pure read.
 *
 * Used by the Commercials tab and the Social -> Commercial bridge to
 * populate an editable textarea before the operator clicks Generate.
 *
 * Query params:
 *   assetType:        'image' | 'video' (required)
 *   durationSeconds:  1-15 (video only, defaults to 6)
 *   logoSpace:        'none' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' (optional)
 *
 * Response:
 *   { ok: true, prompt, source: 'visual_brief' | 'audit' | 'fallback', briefId: number | null }
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { buildPromptForLead, type LogoSpace, type CommercialAngle } from '@/lib/grok/discoverer';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_LOGO_SPACES: ReadonlySet<LogoSpace> = new Set([
  'none',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right'
] as const);

export async function GET(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/commercial/prompt-preview',
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
  const assetTypeRaw = url.searchParams.get('assetType');
  if (assetTypeRaw !== 'image' && assetTypeRaw !== 'video') {
    return NextResponse.json({ error: 'assetType must be "image" or "video"' }, { status: 400 });
  }
  const assetType = assetTypeRaw;

  let durationSeconds: number | undefined;
  const durRaw = url.searchParams.get('durationSeconds');
  if (durRaw !== null) {
    const n = Number(durRaw);
    if (!Number.isFinite(n) || n < 1 || n > 15) {
      return NextResponse.json({ error: 'durationSeconds must be a number 1-15' }, { status: 400 });
    }
    durationSeconds = Math.round(n);
  }

  let logoSpace: LogoSpace | undefined;
  const lsRaw = url.searchParams.get('logoSpace');
  if (lsRaw !== null) {
    if (!VALID_LOGO_SPACES.has(lsRaw as LogoSpace)) {
      return NextResponse.json({ error: 'invalid logoSpace' }, { status: 400 });
    }
    logoSpace = lsRaw as LogoSpace;
  }

  const angleRaw = url.searchParams.get('angle');
  const angle: CommercialAngle | undefined =
    angleRaw === 'av_brand' || angleRaw === 'industry' || angleRaw === 'business' ? angleRaw : undefined;

  // Resolve the audit_id -> internal lead id (same approach as the POST route).
  const db = getAvDb();
  const [leadRows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
    [params.audit_id]
  );
  if (leadRows.length === 0) {
    return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  }

  try {
    const built = await buildPromptForLead(leadRows[0].id, {
      assetType,
      durationSeconds,
      logoSpace,
      angle
    });
    if (!built) return NextResponse.json({ error: 'lead not found' }, { status: 404 });
    return NextResponse.json({
      ok: true,
      prompt: built.prompt,
      source: built.source,
      briefId: built.briefId
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'server error', message: (err as Error).message.slice(0, 300) },
      { status: 500 }
    );
  }
}
