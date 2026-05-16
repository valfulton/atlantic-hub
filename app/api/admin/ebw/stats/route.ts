/**
 * GET /api/admin/ebw/stats — counts across the EBW data surface.
 *
 * Returns:
 *   - inquiries: total charter inquiries received (form-driven)
 *   - bookings:  total confirmed bookings (Val-logged)
 *   - bookingsThisMonth, revenueThisMonth, revenueYtd
 *   - partners: { vessels, captains }
 *   - investors: total investor_registrations
 *   - recentActivity: last 5 marketing_activity rows
 */
import { NextRequest, NextResponse } from 'next/server';
import { getEbwDb } from '@/lib/db/ebw';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface ScalarRow extends RowDataPacket { n: number }
interface SumRow extends RowDataPacket { s: number | null }

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/ebw/stats',
    tenantId: 'ebw'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_ebw_enabled'))) {
    return NextResponse.json({ error: 'ebw tab disabled' }, { status: 403 });
  }

  try {
    const db = getEbwDb();

    const [inquiriesRows] = await db.execute<ScalarRow[]>('SELECT COUNT(*) AS n FROM charter_inquiries');
    const [bookingsTotalRows] = await db.execute<ScalarRow[]>('SELECT COUNT(*) AS n FROM bookings WHERE archived_at IS NULL');
    const [bookingsMonthRows] = await db.execute<ScalarRow[]>(
      "SELECT COUNT(*) AS n FROM bookings WHERE archived_at IS NULL AND booked_on >= DATE_FORMAT(NOW(), '%Y-%m-01')"
    );
    const [revMonthRows] = await db.execute<SumRow[]>(
      "SELECT COALESCE(SUM(amount),0) AS s FROM revenue_entries WHERE entry_date >= DATE_FORMAT(NOW(), '%Y-%m-01')"
    );
    const [revYtdRows] = await db.execute<SumRow[]>(
      "SELECT COALESCE(SUM(amount),0) AS s FROM revenue_entries WHERE YEAR(entry_date) = YEAR(NOW())"
    );
    const [vesselsRows] = await db.execute<ScalarRow[]>('SELECT COUNT(*) AS n FROM vessel_listings');
    const [captainsRows] = await db.execute<ScalarRow[]>('SELECT COUNT(*) AS n FROM captain_applications');
    const [investorsRows] = await db.execute<ScalarRow[]>('SELECT COUNT(*) AS n FROM investor_registrations');
    const [activityRows] = await db.execute<RowDataPacket[]>(
      `SELECT activity_id, occurred_on, activity_type, prospect_label, outcome
         FROM marketing_activity
         ORDER BY occurred_on DESC, activity_id DESC
         LIMIT 5`
    );

    return NextResponse.json({
      stats: {
        inquiries: inquiriesRows[0].n,
        bookingsTotal: bookingsTotalRows[0].n,
        bookingsThisMonth: bookingsMonthRows[0].n,
        revenueThisMonth: Number(revMonthRows[0].s ?? 0),
        revenueYtd: Number(revYtdRows[0].s ?? 0),
        partners: { vessels: vesselsRows[0].n, captains: captainsRows[0].n },
        investors: investorsRows[0].n,
        recentActivity: activityRows.map((r) => ({
          activityId: r.activity_id,
          occurredOn: r.occurred_on,
          activityType: r.activity_type,
          prospectLabel: r.prospect_label,
          outcome: r.outcome
        }))
      }
    });
  } catch (err) {
    console.error('[ebw:stats]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
