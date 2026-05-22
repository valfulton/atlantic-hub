/**
 * POST /api/admin/pr/opportunities/[id]/schedule
 *
 * Schedule the opportunity's drafted pitch across one or more connected profiles
 * at a chosen date/time. Creates one scheduled social_outbox row per profile so
 * they populate the Campaign Timeline. Reuses the (possibly edited) latest draft
 * pitch body and, if a commercial was already attached to this opportunity, the
 * same media across every profile.
 *
 * Body: { connectionIds: number[], scheduledFor: string (ISO) }
 *
 * NOTE: this POPULATES the calendar. Auto-publishing at the scheduled time is the
 * publisher cron (separate step). Until then, scheduled posts can be published
 * manually with the Publish action.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import { DEFAULT_TENANT, PR_EVENTS } from '@/lib/pr/types';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface OppRow extends RowDataPacket {
  id: number;
  tenant_id: string;
  matched_lead_id: number | null;
  linked_outbox_id: number | null;
}
interface PitchRow extends RowDataPacket {
  body_text: string | null;
}
interface OutboxMediaRow extends RowDataPacket {
  asset_id: number | null;
  media_url: string | null;
  media_type: string | null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/pr/opportunities/[id]/schedule:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const oppId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(oppId) || oppId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const connectionIds = Array.isArray(body.connectionIds)
    ? (body.connectionIds as unknown[]).filter((n): n is number => typeof n === 'number')
    : [];
  if (!connectionIds.length) {
    return NextResponse.json({ error: 'select at least one profile' }, { status: 400 });
  }
  const scheduledForRaw = typeof body.scheduledFor === 'string' ? body.scheduledFor : '';
  const when = new Date(scheduledForRaw);
  if (Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: 'valid scheduledFor (date/time) required' }, { status: 400 });
  }
  const scheduledFor = when.toISOString().slice(0, 19).replace('T', ' ');

  try {
    const db = getAvDb();

    const [oppRows] = await db.execute<OppRow[]>(
      `SELECT id, tenant_id, matched_lead_id, linked_outbox_id FROM pr_opportunities WHERE id = ? LIMIT 1`,
      [oppId]
    );
    const opp = oppRows[0];
    if (!opp) return NextResponse.json({ error: 'opportunity not found' }, { status: 404 });
    const tenantId = opp.tenant_id || DEFAULT_TENANT;

    const [pitchRows] = await db.execute<PitchRow[]>(
      `SELECT body_text FROM pr_pitches
        WHERE opportunity_id = ? AND status = 'draft'
        ORDER BY id DESC LIMIT 1`,
      [oppId]
    );
    const bodyText = (pitchRows[0]?.body_text ?? '').trim();
    if (!bodyText) {
      return NextResponse.json({ error: 'draft a pitch before scheduling' }, { status: 409 });
    }

    // Reuse the commercial already attached to this opportunity, if any.
    let media: { asset_id: number | null; media_url: string | null; media_type: string | null } = {
      asset_id: null,
      media_url: null,
      media_type: 'none'
    };
    if (opp.linked_outbox_id) {
      const [mrows] = await db.execute<OutboxMediaRow[]>(
        `SELECT asset_id, media_url, media_type FROM social_outbox WHERE id = ? LIMIT 1`,
        [opp.linked_outbox_id]
      );
      if (mrows[0]) media = mrows[0];
    }

    // Validate the selected connections are active + belong to this tenant.
    const [conns] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM social_connections WHERE tenant_id = ? AND status = 'active'`,
      [tenantId]
    );
    const allowed = new Set(conns.map((c) => c.id));
    const targets = connectionIds.filter((id) => allowed.has(id));
    if (!targets.length) {
      return NextResponse.json({ error: 'no valid active profiles selected for this brand' }, { status: 400 });
    }

    const outboxIds: number[] = [];
    for (const connectionId of targets) {
      const [res] = await db.execute<ResultSetHeader>(
        `INSERT INTO social_outbox
           (tenant_id, connection_id, lead_id, asset_id, body_text, media_url, media_type,
            status, scheduled_for, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
        [
          tenantId,
          connectionId,
          opp.matched_lead_id,
          media.asset_id,
          bodyText,
          media.media_url,
          media.media_type ?? 'none',
          scheduledFor,
          guard.actor.userId
        ]
      );
      outboxIds.push(res.insertId);
      await logEvent({
        eventType: PR_EVENTS.socialQueued,
        leadId: opp.matched_lead_id,
        userId: guard.actor.userId,
        source: 'pr_schedule',
        payload: { opportunity_id: oppId, outbox_id: res.insertId, connection_id: connectionId, status: 'scheduled', scheduled_for: scheduledFor }
      });
    }

    // Advance the opportunity + remember one of the scheduled rows.
    await db.execute<ResultSetHeader>(
      `UPDATE pr_opportunities
          SET status = CASE WHEN status = 'new' THEN 'drafted' ELSE status END,
              linked_outbox_id = COALESCE(linked_outbox_id, ?),
              updated_at = NOW()
        WHERE id = ?`,
      [outboxIds[0] ?? null, oppId]
    );

    return NextResponse.json({ ok: true, scheduled: outboxIds.length, scheduledFor, outboxIds });
  } catch (err) {
    console.error('[pr:schedule]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
