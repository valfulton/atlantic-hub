/**
 * POST /api/admin/campaigns/lines/[id]/commercial/[asset_id]/queue-social   (#61 Inc 2)
 *
 * From a line-born commercial that's been branded, queue draft social_outbox
 * rows — one per active social_connection under the line's tenant — for human
 * review. NEVER auto-publishes (per the approval+branding gate). The operator
 * (or the client, post-Inc 3) approves the draft in the calendar/timeline UI;
 * publishing happens there, gated by approval.
 *
 * Tenant resolution:
 *   - client-owned line (clientId > 0) -> tenant_id = `client:<id>`
 *   - house line (clientId NULL)       -> tenant_id = `av`
 *
 * Media URL: we use the raw provider storage_url (Grok signed URL — publicly
 * fetchable by LinkedIn's media-upload path). The branded mp4 sits in
 * branded_blobs behind admin auth; it's for review/playback, not for the
 * actual upstream post. Same pattern the lead-side commercial flow uses.
 *
 * Auto-thread: each new outbox row is linked to the same narrative line as
 * the commercial (asset_type='social_post', role='advances'). One story, every
 * channel.
 *
 * Owner + staff only. AV-tab-gated.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { getLane } from '@/lib/campaigns/store';
import { linkAssetToLine } from '@/lib/campaigns/line_links';
import { logEvent } from '@/lib/events/log';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface LineAssetRow extends RowDataPacket {
  id: number;
  narrative_line_id: number | null;
  lead_id: number | null;
  asset_type: 'image' | 'video';
  storage_url: string | null;
  generation_status: string;
  branded_status: string | null;
}

function parseLineId(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Tenant for a line-born asset. Mirrors the pattern in the PR queue route
 *  + social_outbox seed rows (`client:<id>` for client-owned content). */
function tenantForLineOwner(clientId: number | null): string {
  return clientId && clientId > 0 ? `client:${clientId}` : 'av';
}

/** Build a draft caption from the line. Operator can edit in the calendar
 *  before publish. Keep it short; LinkedIn cuts off long captions in-feed.
 *  Falls back to just the line name when there's no thesis. */
function buildDraftCaption(name: string, thesis: string | null): string {
  const t = (thesis ?? '').trim();
  if (!t) return name.trim();
  // If the thesis already reads as a sentence, lead with it; otherwise glue.
  return t.length > 280 ? t.slice(0, 277).trimEnd() + '…' : t;
}

export async function POST(req: NextRequest, { params }: { params: { id: string; asset_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/campaigns/lines/[id]/commercial/[asset_id]/queue-social:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const lineId = parseLineId(params.id);
  if (!lineId) return NextResponse.json({ error: 'invalid line id' }, { status: 400 });
  const assetId = Number.parseInt(params.asset_id, 10);
  if (!Number.isFinite(assetId) || assetId <= 0) {
    return NextResponse.json({ error: 'invalid asset_id' }, { status: 400 });
  }

  const line = await getLane(lineId);
  if (!line) return NextResponse.json({ error: 'line not found' }, { status: 404 });

  const db = getAvDb();
  const [assetRows] = await db.execute<LineAssetRow[]>(
    `SELECT id, narrative_line_id, lead_id, asset_type, storage_url, generation_status, branded_status
       FROM grok_imagine_assets WHERE id = ? LIMIT 1`,
    [assetId]
  );
  const asset = assetRows[0];
  if (!asset || asset.narrative_line_id !== lineId || asset.lead_id !== null) {
    return NextResponse.json({ error: 'asset not found on this line' }, { status: 404 });
  }
  if (asset.generation_status !== 'succeeded' || !asset.storage_url) {
    return NextResponse.json({ error: `asset not ready (status=${asset.generation_status})` }, { status: 409 });
  }
  // Branding is the approval gate's brand half — we won't queue unbranded
  // video to the social timeline. Honest copy points val to Inc 1's button.
  if (asset.asset_type === 'video' && asset.branded_status !== 'ready') {
    return NextResponse.json(
      { error: 'brand the video first (✨ Brand it) — drafts are queued post-branding so the public never sees the raw cut.' },
      { status: 409 }
    );
  }

  // Resolve the tenant and pull every active connection underneath it. Empty
  // result -> we tell val honestly there's nowhere to queue to.
  const tenantId = tenantForLineOwner(line.clientId);
  const [conns] = await db.execute<(RowDataPacket & { id: number; provider: string; display_name: string | null })[]>(
    `SELECT id, provider, display_name FROM social_connections
      WHERE tenant_id = ? AND status = 'active'
      ORDER BY provider`,
    [tenantId]
  );
  if (conns.length === 0) {
    return NextResponse.json(
      {
        error: line.clientId
          ? 'no active social connections for this client — they need to connect a profile at /client/social first.'
          : 'no active house brand social connections — connect a profile at /admin/social first.'
      },
      { status: 409 }
    );
  }

  const mediaType: 'video' | 'image' = asset.asset_type === 'video' ? 'video' : 'image';
  const caption = buildDraftCaption(line.name, line.thesis);
  const outboxIds: number[] = [];
  for (const conn of conns) {
    try {
      const [ins] = await db.execute<ResultSetHeader>(
        `INSERT INTO social_outbox
           (tenant_id, connection_id, lead_id, asset_id, body_text, media_url, media_type,
            status, scheduled_for, created_by_user_id)
         VALUES (?, ?, NULL, ?, ?, ?, ?, 'draft', NULL, ?)`,
        [tenantId, conn.id, assetId, caption, asset.storage_url, mediaType, guard.actor.userId]
      );
      outboxIds.push(ins.insertId);
      // Narrative spine: each queued post advances the same line as the
      // commercial. Non-fatal — never let a link failure break the queue.
      linkAssetToLine({
        tenantId: line.tenantId,
        narrativeLineId: lineId,
        assetType: 'social_post',
        assetId: ins.insertId,
        role: 'advances',
        note: 'queued from line-born commercial',
        createdByUserId: guard.actor.userId
      }).catch(() => {});
    } catch (err) {
      console.error('[queue-social:insert]', conn.provider, (err as Error).message);
    }
  }

  await logEvent({
    eventType: 'commercial.queued_to_social',
    leadId: null,
    userId: guard.actor.userId,
    source: 'narrative_spine',
    status: 'success',
    payload: {
      asset_id: assetId,
      narrative_line_id: lineId,
      tenant_id: tenantId,
      client_id: line.clientId,
      outbox_ids: outboxIds,
      connection_count: conns.length
    }
  });

  return NextResponse.json({
    ok: true,
    queued: outboxIds.length,
    connectionCount: conns.length,
    outboxIds,
    providers: conns.map((c) => c.provider)
  });
}
