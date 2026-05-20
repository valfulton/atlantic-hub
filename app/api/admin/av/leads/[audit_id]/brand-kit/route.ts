/**
 * GET  /api/admin/av/leads/[audit_id]/brand-kit
 *   Returns the current brand kit for this lead (logo metadata +
 *   settings + data URL for preview), or { ok: true, kit: null } if
 *   none exists yet.
 *
 * PUT  /api/admin/av/leads/[audit_id]/brand-kit
 *   Updates the composite settings without touching the logo bytes.
 *   Body: { defaultPosition?, defaultOpacity?, defaultScale?, defaultPadding?, autoApply? }
 *
 * POST /api/admin/av/leads/[audit_id]/brand-kit  (logo upload)
 *   Multipart form data with field "logo". Replaces the stored logo
 *   bytes; creates the brand kit row if it didn't exist.
 *
 * DELETE /api/admin/av/leads/[audit_id]/brand-kit
 *   Clears the logo bytes but keeps the settings row.
 *
 * Owner + staff only. Forbidden for client_user.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import {
  getBrandKitForLead,
  upsertBrandKit,
  clearBrandKitLogo
} from '@/lib/brand_kit/store';
import type { LogoPosition } from '@/lib/brand_kit/types';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_POSITIONS: ReadonlySet<LogoPosition> = new Set([
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right'
] as const);
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB
const ACCEPTED_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']);

async function resolveLeadId(auditId: string): Promise<number | null> {
  if (!UUID_RE.test(auditId)) return null;
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
    [auditId]
  );
  return rows[0]?.id ?? null;
}

export async function GET(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/brand-kit',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const leadId = await resolveLeadId(params.audit_id);
  if (!leadId) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

  try {
    const kit = await getBrandKitForLead(leadId, { includeDataUrl: true });
    return NextResponse.json({ ok: true, kit });
  } catch (err) {
    console.error('[brand-kit:get]', (err as Error).message);
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/brand-kit:PUT',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const leadId = await resolveLeadId(params.audit_id);
  if (!leadId) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const updates: Parameters<typeof upsertBrandKit>[0] = {
    leadId,
    createdByUserId: guard.actor.userId
  };

  if (typeof payload.defaultPosition === 'string') {
    if (!VALID_POSITIONS.has(payload.defaultPosition as LogoPosition)) {
      return NextResponse.json({ error: 'invalid defaultPosition' }, { status: 400 });
    }
    updates.defaultPosition = payload.defaultPosition as LogoPosition;
  }
  if (typeof payload.defaultOpacity === 'number') {
    if (payload.defaultOpacity < 0 || payload.defaultOpacity > 1) {
      return NextResponse.json({ error: 'defaultOpacity must be 0-1' }, { status: 400 });
    }
    updates.defaultOpacity = payload.defaultOpacity;
  }
  if (typeof payload.defaultScale === 'number') {
    if (payload.defaultScale < 0.02 || payload.defaultScale > 0.6) {
      return NextResponse.json({ error: 'defaultScale must be 0.02-0.6' }, { status: 400 });
    }
    updates.defaultScale = payload.defaultScale;
  }
  if (typeof payload.defaultPadding === 'number') {
    if (payload.defaultPadding < 0 || payload.defaultPadding > 200) {
      return NextResponse.json({ error: 'defaultPadding must be 0-200' }, { status: 400 });
    }
    updates.defaultPadding = Math.round(payload.defaultPadding);
  }
  if (typeof payload.autoApply === 'boolean') {
    updates.autoApply = payload.autoApply;
  }

  try {
    const kit = await upsertBrandKit(updates);
    return NextResponse.json({ ok: true, kit });
  } catch (err) {
    console.error('[brand-kit:put]', (err as Error).message);
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/brand-kit:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const leadId = await resolveLeadId(params.audit_id);
  if (!leadId) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'expected multipart form data' }, { status: 400 });
  }

  const file = form.get('logo');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing "logo" file field' }, { status: 400 });
  }
  if (file.size > MAX_LOGO_BYTES) {
    return NextResponse.json(
      { error: `logo too large (max ${MAX_LOGO_BYTES} bytes / 2 MB)` },
      { status: 413 }
    );
  }
  if (!ACCEPTED_MIMES.has(file.type)) {
    return NextResponse.json(
      { error: `unsupported mime type: ${file.type}. PNG, JPEG, WebP, or SVG.` },
      { status: 415 }
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Try to read width/height via sharp. Best-effort -- the route still
  // succeeds if sharp refuses (some SVGs) or isn't installed yet locally.
  let logoWidth: number | undefined;
  let logoHeight: number | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore -- sharp resolved at runtime; listed in package.json
    const sharp = (await import('sharp')).default as (b: Buffer) => { metadata(): Promise<{ width?: number; height?: number }> };
    const meta = await sharp(buffer).metadata();
    logoWidth = meta.width ?? undefined;
    logoHeight = meta.height ?? undefined;
  } catch {
    // sharp may refuse some SVGs; ignore dimensions in that case.
  }

  try {
    const kit = await upsertBrandKit({
      leadId,
      logoBuffer: buffer,
      logoMimeType: file.type,
      logoFilename: file.name || undefined,
      logoWidth,
      logoHeight,
      createdByUserId: guard.actor.userId
    });
    return NextResponse.json({ ok: true, kit });
  } catch (err) {
    console.error('[brand-kit:upload]', (err as Error).message);
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/brand-kit:DELETE',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role !== 'owner') {
    return NextResponse.json({ error: 'forbidden -- owner only' }, { status: 403 });
  }

  const leadId = await resolveLeadId(params.audit_id);
  if (!leadId) return NextResponse.json({ error: 'lead not found' }, { status: 404 });

  try {
    await clearBrandKitLogo(leadId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[brand-kit:delete]', (err as Error).message);
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}
