import { NextRequest, NextResponse } from 'next/server';
import { getEbwDb } from '@/lib/db/ebw';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

const VALID_STATUS = new Set(['booked', 'deposit_paid', 'completed', 'cancelled', 'refunded']);

interface BookingRow extends RowDataPacket {
  booking_id: number;
  booking_uuid: string;
  booked_on: string;
  event_date: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  market: string | null;
  group_size: number | null;
  event_type: string | null;
  vessel_partner: string | null;
  event_planner: string | null;
  gross_revenue: string | null;
  ebw_commission: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/ebw/bookings', tenantId: 'ebw' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_ebw_enabled'))) return NextResponse.json({ error: 'ebw tab disabled' }, { status: 403 });

  try {
    const db = getEbwDb();
    const [rows] = await db.execute<BookingRow[]>(
      `SELECT booking_id, booking_uuid, booked_on, event_date, customer_name, customer_email,
              customer_phone, market, group_size, event_type, vessel_partner, event_planner,
              gross_revenue, ebw_commission, status, notes, created_at
         FROM bookings
        WHERE archived_at IS NULL
        ORDER BY booked_on DESC, booking_id DESC
        LIMIT 500`
    );
    return NextResponse.json({
      bookings: rows.map((r) => ({
        bookingId: r.booking_id,
        bookingUuid: r.booking_uuid,
        bookedOn: r.booked_on,
        eventDate: r.event_date,
        customerName: r.customer_name,
        customerEmail: r.customer_email,
        customerPhone: r.customer_phone,
        market: r.market,
        groupSize: r.group_size,
        eventType: r.event_type,
        vesselPartner: r.vessel_partner,
        eventPlanner: r.event_planner,
        grossRevenue: r.gross_revenue ? Number(r.gross_revenue) : null,
        ebwCommission: r.ebw_commission ? Number(r.ebw_commission) : null,
        status: r.status,
        notes: r.notes,
        createdAt: r.created_at
      }))
    });
  } catch (err) {
    console.error('[ebw:bookings:get]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/ebw/bookings:POST', tenantId: 'ebw' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_ebw_enabled'))) return NextResponse.json({ error: 'ebw tab disabled' }, { status: 403 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const customerName = typeof body.customerName === 'string' ? body.customerName.trim() : '';
  if (!customerName) return NextResponse.json({ error: 'customerName required' }, { status: 400 });
  const bookedOn = typeof body.bookedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.bookedOn) ? body.bookedOn : null;
  if (!bookedOn) return NextResponse.json({ error: 'bookedOn (YYYY-MM-DD) required' }, { status: 400 });
  const status = typeof body.status === 'string' && VALID_STATUS.has(body.status) ? body.status : 'booked';

  const safeStr = (k: string, max = 255) => {
    const v = body[k];
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (!t) return null;
    if (t.length > max) return t.slice(0, max);
    return t;
  };
  const safeDate = (k: string) => {
    const v = body[k];
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  };
  const safeMoney = (k: string) => {
    const v = body[k];
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return n.toFixed(2);
  };
  const safeInt = (k: string) => {
    const v = body[k];
    if (v === null || v === undefined || v === '') return null;
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const bookingUuid = randomUUID();

  try {
    const db = getEbwDb();
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO bookings (
         booking_uuid, booked_on, event_date, customer_name, customer_email, customer_phone,
         market, group_size, event_type, vessel_partner, event_planner,
         gross_revenue, ebw_commission, status, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bookingUuid,
        bookedOn,
        safeDate('eventDate'),
        customerName,
        safeStr('customerEmail'),
        safeStr('customerPhone', 50),
        safeStr('market', 100),
        safeInt('groupSize'),
        safeStr('eventType', 100),
        safeStr('vesselPartner'),
        safeStr('eventPlanner'),
        safeMoney('grossRevenue'),
        safeMoney('ebwCommission'),
        status,
        safeStr('notes', 8000)
      ]
    );

    return NextResponse.json({ bookingId: result.insertId, bookingUuid }, { status: 201 });
  } catch (err) {
    console.error('[ebw:bookings:post]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
