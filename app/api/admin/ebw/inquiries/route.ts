import { NextRequest, NextResponse } from 'next/server';
import { getEbwDb } from '@/lib/db/ebw';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface InquiryRow extends RowDataPacket {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  market: string | null;
  event_date: string | null;
  group_size: string | null;
  event_type: string | null;
  budget: string | null;
  message: string | null;
  submitted_at: string;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/ebw/inquiries', tenantId: 'ebw' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_ebw_enabled'))) return NextResponse.json({ error: 'ebw tab disabled' }, { status: 403 });

  try {
    const db = getEbwDb();
    const [rows] = await db.execute<InquiryRow[]>(
      `SELECT id, name, email, phone, market, event_date, group_size, event_type, budget, message, submitted_at
         FROM charter_inquiries ORDER BY submitted_at DESC LIMIT 500`
    );
    return NextResponse.json({
      inquiries: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        market: r.market,
        eventDate: r.event_date,
        groupSize: r.group_size,
        eventType: r.event_type,
        budget: r.budget,
        message: r.message,
        submittedAt: r.submitted_at
      }))
    });
  } catch (err) {
    console.error('[ebw:inquiries:get]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
