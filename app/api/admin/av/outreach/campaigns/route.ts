/**
 * /api/admin/av/outreach/campaigns
 *
 * GET  -> list campaigns with simple counts (drafts/sent/replied today)
 * POST -> create a new campaign
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

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
  mailbox_display_name: string | null;
  pending_count: number;
  sent_today: number;
  replied_today: number;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/campaigns',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  const db = getAvDb();
  const [rows] = await db.execute<CampaignRow[]>(
    `SELECT c.id, c.mailbox_id, c.name, c.description, c.target_business, c.status,
            c.ai_offer_summary, c.ai_cta, c.ai_signature, c.daily_send_limit,
            c.require_approval, c.auto_advance_stage, c.created_at, c.updated_at,
            mb.display_name AS mailbox_display_name,
            (SELECT COUNT(*) FROM outreach_messages m
              WHERE m.campaign_id = c.id AND m.status = 'pending_approval') AS pending_count,
            (SELECT COUNT(*) FROM outreach_messages m
              WHERE m.campaign_id = c.id AND m.sent_at >= CURDATE()) AS sent_today,
            (SELECT COUNT(*) FROM outreach_replies r
              WHERE r.campaign_id = c.id AND r.received_at >= CURDATE()) AS replied_today
       FROM outreach_campaigns c
       LEFT JOIN outreach_mailboxes mb ON mb.id = c.mailbox_id
      WHERE c.archived_at IS NULL
      ORDER BY c.status = 'active' DESC, c.created_at DESC`
  );
  return NextResponse.json({ campaigns: rows });
}

interface CreateBody {
  name: string;
  description?: string;
  mailboxId: number;
  targetBusiness?: 'av' | 'ebw' | 'both';
  aiOfferSummary?: string;
  aiCta?: string;
  aiSignature?: string;
  dailySendLimit?: number;
  requireApproval?: boolean;
  autoAdvanceStage?: boolean;
  status?: 'draft' | 'active' | 'paused';
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/campaigns',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body.name || !body.mailboxId) {
    return NextResponse.json({ error: 'name and mailboxId required' }, { status: 400 });
  }
  const dailyLimit = Number.isFinite(body.dailySendLimit)
    ? Math.max(0, Math.min(500, Number(body.dailySendLimit)))
    : 5;

  const db = getAvDb();
  const [res] = await db.execute<ResultSetHeader>(
    `INSERT INTO outreach_campaigns
       (organization_id, mailbox_id, name, description, target_business, status,
        ai_offer_summary, ai_cta, ai_signature, daily_send_limit, require_approval,
        auto_advance_stage, created_by_user_id)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.mailboxId,
      body.name,
      body.description ?? null,
      body.targetBusiness ?? 'av',
      body.status ?? 'draft',
      body.aiOfferSummary ?? null,
      body.aiCta ?? null,
      body.aiSignature ?? null,
      dailyLimit,
      body.requireApproval === false ? 0 : 1,
      body.autoAdvanceStage === false ? 0 : 1,
      guard.actor.userId
    ]
  );
  await logEvent({
    eventType: 'outreach.campaign_created',
    userId: guard.actor.userId,
    source: 'outreach',
    payload: { campaign_id: res.insertId, mailbox_id: body.mailboxId }
  });
  return NextResponse.json({ ok: true, campaignId: res.insertId });
}
