/**
 * POST /api/admin/av/clients/[client_id]/extract-brand-kit  (#208)
 *
 * Two modes:
 *   - 'preview' -> fetch URL + LLM, return brand kit suggestion. No writes.
 *   - 'apply'   -> caller sends the (operator-edited) suggestion back; we
 *                  merge it into creative_briefs.brief_payload using canonical
 *                  intake keys + adds logo_url + brand_aesthetic + brand_typography.
 *
 * Apply respects `blanksOnly` (default true) so val's hand-curated fields are
 * never overwritten.
 *
 * Owner / staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { getBriefPayload, saveBriefPayload } from '@/lib/client/brief_store';
import { extractBrandKitFromUrl, BrandKitFetchError } from '@/lib/client/brand_kit_extractor';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface PreviewBody {
  mode: 'preview';
  url: string;
}

interface ApplyBody {
  mode: 'apply';
  /** Operator-edited (or kept-as-is) suggestion from the preview response. */
  colors: string[];
  logoUrl: string | null;
  aesthetic: string | null;
  typography: string | null;
  /** When true (default), only fill blank brief keys. False = overwrite. */
  blanksOnly?: boolean;
}

async function loadClientName(clientId: number): Promise<string | null> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { client_name: string | null })[]>(
      `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
      [clientId]
    );
    return rows[0]?.client_name?.trim() || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[client_id]/extract-brand-kit:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client_id' }, { status: 400 });
  }

  let body: PreviewBody | ApplyBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  // -------- PREVIEW --------
  if (body.mode === 'preview') {
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });

    const brandHint = await loadClientName(clientId);
    try {
      const result = await extractBrandKitFromUrl({ url, brandHint });
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof BrandKitFetchError) {
        return NextResponse.json({ error: err.message }, { status: err.statusCode });
      }
      console.error('[extract-brand-kit:preview]', (err as Error).message);
      return NextResponse.json({ error: 'preview failed', detail: (err as Error).message }, { status: 500 });
    }
  }

  // -------- APPLY --------
  if (body.mode === 'apply') {
    const blanksOnly = body.blanksOnly !== false;
    try {
      const current = (await getBriefPayload('av', clientId)) ?? {} as Record<string, unknown>;
      const cur = current as Record<string, unknown>;

      const isBlank = (k: string): boolean => {
        const v = cur[k];
        return typeof v !== 'string' || v.trim().length === 0;
      };

      // Canonical intake keys we touch:
      //   brand_colors (string of names/hex), has_logo (yes/no), logo_url (new),
      //   brand_aesthetic, brand_typography
      const patch: Record<string, string> = {};
      const writtenKeys: string[] = [];
      const skippedNonBlank: string[] = [];

      // Colors -> store as comma-separated hex string in canonical brand_colors.
      const colorsCsv = (body.colors || []).filter((c) => typeof c === 'string' && c.trim()).join(', ');
      if (colorsCsv) {
        if (!blanksOnly || isBlank('brand_colors')) {
          patch.brand_colors = colorsCsv.slice(0, 1000);
          writtenKeys.push('brand_colors');
        } else skippedNonBlank.push('brand_colors');
      }

      // Logo URL is a new key; also flip has_logo if we have one.
      if (body.logoUrl && /^https?:\/\//.test(body.logoUrl)) {
        if (!blanksOnly || isBlank('logo_url')) {
          patch.logo_url = body.logoUrl.slice(0, 2000);
          writtenKeys.push('logo_url');
        } else skippedNonBlank.push('logo_url');
        if (!blanksOnly || isBlank('has_logo')) {
          patch.has_logo = 'yes';
          writtenKeys.push('has_logo');
        }
      }

      if (body.aesthetic && body.aesthetic.trim()) {
        if (!blanksOnly || isBlank('brand_aesthetic')) {
          patch.brand_aesthetic = body.aesthetic.trim().slice(0, 400);
          writtenKeys.push('brand_aesthetic');
        } else skippedNonBlank.push('brand_aesthetic');
      }

      if (body.typography && body.typography.trim()) {
        if (!blanksOnly || isBlank('brand_typography')) {
          patch.brand_typography = body.typography.trim().slice(0, 400);
          writtenKeys.push('brand_typography');
        } else skippedNonBlank.push('brand_typography');
      }

      if (writtenKeys.length === 0) {
        return NextResponse.json({
          ok: true,
          writtenKeys: [],
          skippedNonBlank,
          note: 'Nothing to write — every key was already set and blanksOnly was true.'
        });
      }

      const merged = { ...cur, ...patch };
      const ok = await saveBriefPayload('av', clientId, merged, {
        changedBy: guard.actor.userId ? `user:${guard.actor.userId}` : 'operator',
        source: 'brand_kit'
      });
      if (!ok) return NextResponse.json({ error: 'save failed' }, { status: 500 });

      await logEvent({
        eventType: 'brand_kit.applied',
        userId: guard.actor.userId,
        organizationId: clientId,
        source: 'operator',
        payload: { client_id: clientId, written_keys: writtenKeys, skipped: skippedNonBlank }
      });

      return NextResponse.json({ ok: true, writtenKeys, skippedNonBlank });
    } catch (err) {
      console.error('[extract-brand-kit:apply]', (err as Error).message);
      return NextResponse.json({ error: 'apply failed', detail: (err as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'invalid mode' }, { status: 400 });
}
