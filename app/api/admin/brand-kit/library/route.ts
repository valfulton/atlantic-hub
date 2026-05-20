/**
 * GET  /api/admin/brand-kit/library
 *   List active library logos with data URLs for thumbnail rendering.
 *   Query: ?limit=N&tenantHint=av
 *
 * POST /api/admin/brand-kit/library
 *   Multipart form: { logo: File, displayName: string, tenantHint?: string }
 *   Adds a logo to the reusable library.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { listLibrary, addToLibrary } from '@/lib/brand_kit/library';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ACCEPTED_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']);

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/brand-kit/library',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 50));
  const tenantHint = url.searchParams.get('tenantHint');

  try {
    const items = await listLibrary({ limit, tenantHint });
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    console.error('[brand-kit:library:list]', (err as Error).message);
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/brand-kit/library:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

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
    return NextResponse.json({ error: 'logo too large (max 2 MB)' }, { status: 413 });
  }
  if (!ACCEPTED_MIMES.has(file.type)) {
    return NextResponse.json({ error: `unsupported mime: ${file.type}` }, { status: 415 });
  }

  const displayNameRaw = form.get('displayName');
  if (typeof displayNameRaw !== 'string' || displayNameRaw.trim().length === 0) {
    return NextResponse.json({ error: 'displayName required' }, { status: 400 });
  }
  const displayName = displayNameRaw.trim().slice(0, 255);

  const tenantHintRaw = form.get('tenantHint');
  const tenantHint = typeof tenantHintRaw === 'string' && tenantHintRaw.trim().length > 0
    ? tenantHintRaw.trim().slice(0, 64)
    : null;

  const buffer = Buffer.from(await file.arrayBuffer());

  // Try sharp for dimensions; best-effort.
  let logoWidth: number | null = null;
  let logoHeight: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore -- resolved at runtime; sharp listed in package.json
    const sharp = (await import('sharp')).default as (b: Buffer) => { metadata(): Promise<{ width?: number; height?: number }> };
    const meta = await sharp(buffer).metadata();
    logoWidth = meta.width ?? null;
    logoHeight = meta.height ?? null;
  } catch {
    // ignore
  }

  try {
    const item = await addToLibrary({
      displayName,
      tenantHint,
      logoBuffer: buffer,
      logoMimeType: file.type,
      logoFilename: file.name || null,
      logoWidth,
      logoHeight,
      createdByUserId: guard.actor.userId
    });
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    console.error('[brand-kit:library:create]', (err as Error).message);
    return NextResponse.json(
      { error: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}
