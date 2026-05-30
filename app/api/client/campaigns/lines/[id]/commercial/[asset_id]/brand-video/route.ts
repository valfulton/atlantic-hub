/**
 * GET /api/client/campaigns/lines/[id]/commercial/[asset_id]/brand-video   (#61 Inc 3)
 *
 * Client-side read-only stream of a branded line-born commercial. Used by the
 * client review queue so the client previews the BRANDED version (logo
 * overlaid) — what they're actually approving for publish — not the raw cut.
 *
 * Auth: client_user session. Scoped strictly by ownership — the asset must
 * belong to a narrative line whose client_id matches the caller's client_id.
 * Cross-tenant lookups 404 so the URL doesn't leak the existence of other
 * clients' assets.
 *
 * Read-only. No POST — branding is operator-side (Inc 1). The asset row must
 * already have branded_status='ready' + a stored key. Otherwise: 404.
 */
import { NextRequest, NextResponse } from 'next/server';
import { headers as nextHeaders } from 'next/headers';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { activeBrandFor } from '@/lib/client/active-brand';
import { getAvDb } from '@/lib/db/av';
import { getBrandedVideo } from '@/lib/storage/branded_blobs';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface AssetRow extends RowDataPacket {
  id: number;
  narrative_line_id: number | null;
  lead_id: number | null;
  branded_status: string | null;
  branded_storage_key: string | null;
  client_id: number | null;
}

function parseLineId(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string; asset_id: string } }) {
  const actor = readClientActorFromHeaders(nextHeaders() as unknown as Headers);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const user = await findClientUserById(actor.clientUserId);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Multi-brand: scope to the brand the owner is currently viewing.
  const clientId = await activeBrandFor(actor.clientUserId, user.client_id ?? null);
  if (!clientId) return NextResponse.json({ error: 'no client scope' }, { status: 403 });

  const lineId = parseLineId(params.id);
  if (!lineId) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });
  const assetId = Number.parseInt(params.asset_id, 10);
  if (!Number.isFinite(assetId) || assetId <= 0) {
    return NextResponse.json({ error: 'invalid asset_id' }, { status: 400 });
  }

  // Single JOIN: asset must be ON this line, lead_id NULL (line-born marker),
  // AND the line must be owned by THIS client. Any mismatch -> 404 so we
  // don't reveal whether the asset exists in some other client's pipeline.
  const db = getAvDb();
  const [rows] = await db.execute<AssetRow[]>(
    `SELECT a.id, a.narrative_line_id, a.lead_id, a.branded_status, a.branded_storage_key,
            nl.client_id
       FROM grok_imagine_assets a
       JOIN narrative_lanes nl ON nl.id = a.narrative_line_id
      WHERE a.id = ?
        AND a.narrative_line_id = ?
        AND a.lead_id IS NULL
        AND nl.client_id = ?
      LIMIT 1`,
    [assetId, lineId, clientId]
  );
  const asset = rows[0];
  if (!asset || asset.branded_status !== 'ready' || !asset.branded_storage_key) {
    return NextResponse.json({ error: 'no branded video for this asset yet' }, { status: 404 });
  }

  const bytes = await getBrandedVideo(asset.branded_storage_key);
  if (!bytes) return NextResponse.json({ error: 'branded video missing from store' }, { status: 404 });
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, max-age=300'
    }
  });
}
