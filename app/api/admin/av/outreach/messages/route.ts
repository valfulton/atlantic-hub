/**
 * GET /api/admin/av/outreach/messages
 *
 * Cross-campaign view of pending drafts. Powers the global approval
 * queue on /admin/av/outreach.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/messages',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status') || 'pending_approval';
  const VALID = new Set([
    'pending_approval',
    'approved',
    'sent',
    'replied',
    'bounced',
    'failed',
    'rejected'
  ]);
  const status = VALID.has(statusParam) ? statusParam : 'pending_approval';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 200);

  const db = getAvDb();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.campaign_id, m.lead_id, m.subject, m.body, m.status, m.created_at,
            m.sent_at, m.replied_at, m.ai_grounded_on_audit,
            c.name AS campaign_name,
            l.company, l.email, l.contact_name, l.contact_title, l.industry,
            l.ai_score, l.ai_score_band
       FROM outreach_messages m
       JOIN outreach_campaigns c ON c.id = m.campaign_id
       JOIN leads l ON l.id = m.lead_id
      WHERE m.status = ?
      ORDER BY m.created_at DESC
      LIMIT ${limit}`,
    [status]
  );
  return NextResponse.json({ messages: rows });
}
