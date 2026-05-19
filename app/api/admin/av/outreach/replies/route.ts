/**
 * GET /api/admin/av/outreach/replies
 *
 * Cross-campaign recent replies feed. Powers the "Recent replies"
 * section on /admin/av/outreach.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/outreach/replies',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
  const classification = url.searchParams.get('classification');

  const db = getAvDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (classification) {
    where.push('classification = ?');
    params.push(classification);
  }
  const whereSql = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, message_id, lead_id, campaign_id, reply_from, reply_subject,
            classification, classification_confidence, received_at
       FROM outreach_replies
       ${whereSql}
       ORDER BY received_at DESC
       LIMIT ${limit}`,
    params
  );
  return NextResponse.json({ replies: rows });
}
