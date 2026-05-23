/**
 * GET /api/admin/av/leads/[audit_id]/commercial/[asset_id]/file
 *
 * The STABLE asset URL. Streams the asset's durable bytes from hot storage,
 * persisting them on first access (download the provider URL -> hash -> store).
 * This is what replaces the expiring Grok URL everywhere in the UI: it never
 * 404s once the asset has been seen at least once.
 *
 * Falls back to redirecting to the original provider URL if persistence isn't
 * possible yet (e.g. brand-new asset, blobs unavailable locally).
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { getAssetBytes } from '@/lib/storage/provenance';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row extends RowDataPacket {
  id: number;
  storage_url: string | null;
  lead_audit_id: string;
}

export async function GET(req: NextRequest, { params }: { params: { audit_id: string; asset_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/commercial/[asset_id]/file',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!UUID_RE.test(params.audit_id)) return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });
  const assetId = Number.parseInt(params.asset_id, 10);
  if (!Number.isFinite(assetId) || assetId <= 0) return NextResponse.json({ error: 'invalid asset_id' }, { status: 400 });

  // Ownership check.
  const db = getAvDb();
  const [rows] = await db.execute<Row[]>(
    `SELECT a.id, a.storage_url, l.audit_id AS lead_audit_id
       FROM grok_imagine_assets a INNER JOIN leads l ON l.id = a.lead_id
      WHERE a.id = ? LIMIT 1`,
    [assetId]
  );
  const row = rows[0];
  if (!row || row.lead_audit_id !== params.audit_id) {
    return NextResponse.json({ error: 'asset not found' }, { status: 404 });
  }

  const got = await getAssetBytes(assetId);
  if (got) {
    return new NextResponse(got.bytes, {
      status: 200,
      headers: {
        'Content-Type': got.contentType,
        'Content-Length': String(got.bytes.byteLength),
        // Durable + content-addressed; safe to cache hard.
        'Cache-Control': 'private, max-age=86400'
      }
    });
  }

  // Couldn't persist (e.g. provider URL still valid but blobs unavailable):
  // fall back to the original provider URL so the asset still shows.
  if (row.storage_url) return NextResponse.redirect(row.storage_url);
  return NextResponse.json({ error: 'asset bytes unavailable' }, { status: 404 });
}
