/**
 * /api/admin/av/outreach/campaigns/[id]
 *
 * GET   -> single campaign + queue + recent messages + recent replies
 * PATCH -> update editable fields (status, name, dailySendLimit, etc.)
 * DELETE-> archive
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

const VALID_STATUS = new Set(['draft', 'active', 'paused', 'archived']);

interface CampaignRow extends RowDataPacket {
  id: number;
  mailbox_id: number;
  name: string;
  description: string | null;
  target_business: 'av' | 'ebw' | 'both';
  status: string;
  ai_offer_summary: string | null;
  ai_cta: string | null;
  ai_signature: string | null;
  daily_send_limit: number;
  require_approval: number;
  auto_advance_stage: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/campaigns/[id]',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const db = getAvDb();
  const [crows] = await db.execute<CampaignRow[]>(
    `SELECT id, mailbox_id, name, description, target_business, status,
            ai_offer_summary, ai_cta, ai_signature, daily_send_limit,
            require_approval, auto_advance_stage, created_at, updated_at, archived_at
       FROM outreach_campaigns
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  if (crows.length === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const campaign = crows[0];

  const [pending] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.subject, m.body, m.created_at, m.ai_grounded_on_audit,
            l.company, l.email, l.contact_name, l.ai_score, l.ai_score_band
       FROM outreach_messages m
       JOIN leads l ON l.id = m.lead_id
      WHERE m.campaign_id = ? AND m.status = 'pending_approval'
      ORDER BY m.created_at ASC
      LIMIT 100`,
    [id]
  );
  const [recent] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.lead_id, m.subject, m.status, m.sent_at, m.opened_at,
            m.replied_at, m.bounced_at, l.company, l.email
       FROM outreach_messages m
       JOIN leads l ON l.id = m.lead_id
      WHERE m.campaign_id = ? AND m.status IN ('sent','replied','bounced','failed','rejected')
      ORDER BY COALESCE(m.sent_at, m.updated_at) DESC
      LIMIT 100`,
    [id]
  );
  const [replies] = await db.execute<RowDataPacket[]>(
    `SELECT r.id, r.message_id, r.lead_id, r.reply_from, r.reply_subject,
            r.classification, r.classification_confidence, r.received_at
       FROM outreach_replies r
      WHERE r.campaign_id = ?
      ORDER BY r.received_at DESC
      LIMIT 100`,
    [id]
  );

  return NextResponse.json({ campaign, pending, recent, replies });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/campaigns/[id]',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body.name === 'string') { sets.push('name = ?'); vals.push(body.name); }
  if (typeof body.description === 'string' || body.description === null) {
    sets.push('description = ?'); vals.push(body.description ?? null);
  }
  if (typeof body.status === 'string' && VALID_STATUS.has(body.status)) {
    sets.push('status = ?'); vals.push(body.status);
  }
  if (typeof body.aiOfferSummary === 'string' || body.aiOfferSummary === null) {
    sets.push('ai_offer_summary = ?'); vals.push(body.aiOfferSummary ?? null);
  }
  if (typeof body.aiCta === 'string' || body.aiCta === null) {
    sets.push('ai_cta = ?'); vals.push(body.aiCta ?? null);
  }
  if (typeof body.aiSignature === 'string' || body.aiSignature === null) {
    sets.push('ai_signature = ?'); vals.push(body.aiSignature ?? null);
  }
  if (typeof body.dailySendLimit === 'number') {
    sets.push('daily_send_limit = ?'); vals.push(Math.max(0, Math.min(500, body.dailySendLimit)));
  }
  if (typeof body.requireApproval === 'boolean') {
    sets.push('require_approval = ?'); vals.push(body.requireApproval ? 1 : 0);
  }
  if (typeof body.autoAdvanceStage === 'boolean') {
    sets.push('auto_advance_stage = ?'); vals.push(body.autoAdvanceStage ? 1 : 0);
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'no editable fields supplied' }, { status: 400 });
  }
  sets.push('updated_at = NOW()');
  vals.push(id);

  const db = getAvDb();
  const [res] = await db.execute<ResultSetHeader>(
    `UPDATE outreach_campaigns SET ${sets.join(', ')} WHERE id = ?`,
    vals
  );
  if (res.affectedRows === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });
  await logEvent({
    eventType: 'outreach.campaign_updated',
    userId: guard.actor.userId,
    source: 'outreach',
    payload: { campaign_id: id, fields: Object.keys(body) }
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/campaigns/[id]',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role !== 'owner') {
    return NextResponse.json({ error: 'owner only' }, { status: 403 });
  }
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const db = getAvDb();
  await db.execute<ResultSetHeader>(
    `UPDATE outreach_campaigns SET status = 'archived', archived_at = NOW(), updated_at = NOW() WHERE id = ?`,
    [id]
  );
  await logEvent({
    eventType: 'outreach.campaign_archived',
    userId: guard.actor.userId,
    source: 'outreach',
    payload: { campaign_id: id }
  });
  return NextResponse.json({ ok: true });
}
