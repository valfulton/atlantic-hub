/**
 * GET /api/admin/av/leads/[audit_id]/outreach
 *
 * Per-lead outreach history: messages + replies. Powers the OutreachPanel
 * tab on the lead detail page.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: { audit_id: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/outreach',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!UUID_RE.test(params.audit_id)) {
    return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });
  }
  const db = getAvDb();
  const [leadRows] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE audit_id = ? AND archived_at IS NULL LIMIT 1`,
    [params.audit_id]
  );
  if (leadRows.length === 0) {
    return NextResponse.json({ error: 'lead not found' }, { status: 404 });
  }
  const leadId = leadRows[0].id;
  const [messages] = await db.execute<RowDataPacket[]>(
    `SELECT id, campaign_id, subject, body, status, created_at, sent_at, replied_at,
            ai_grounded_on_audit
       FROM outreach_messages
      WHERE lead_id = ?
      ORDER BY created_at DESC
      LIMIT 100`,
    [leadId]
  );
  const [replies] = await db.execute<RowDataPacket[]>(
    `SELECT id, message_id, reply_from, reply_subject, classification,
            classification_confidence, received_at
       FROM outreach_replies
      WHERE lead_id = ?
      ORDER BY received_at DESC
      LIMIT 100`,
    [leadId]
  );
  return NextResponse.json({ messages, replies });
}
