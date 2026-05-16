import { NextRequest, NextResponse } from 'next/server';
import { getEbwDb } from '@/lib/db/ebw';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

const VALID_STREAMS = new Set([
  'charter_commission',
  'vessel_membership',
  'event_planner_subscription',
  'corporate_retreat',
  'vendor_network',
  'atlantic_vine_services',
  'jet_charter',
  'merchandise',
  'investor_capital',
  'other'
]);

interface RevRow extends RowDataPacket {
  revenue_id: number;
  entry_date: string;
  stream: string;
  amount: string;
  source: string | null;
  booking_id: number | null;
  notes: string | null;
  created_at: string;
}

interface SumRow extends RowDataPacket { stream: string; s: number }

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/ebw/revenue', tenantId: 'ebw' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_ebw_enabled'))) return NextResponse.json({ error: 'ebw tab disabled' }, { status: 403 });

  try {
    const db = getEbwDb();
    const [rows] = await db.execute<RevRow[]>(
      `SELECT revenue_id, entry_date, stream, amount, source, booking_id, notes, created_at
         FROM revenue_entries ORDER BY entry_date DESC, revenue_id DESC LIMIT 500`
    );
    const [sumRows] = await db.execute<SumRow[]>(
      `SELECT stream, COALESCE(SUM(amount),0) AS s FROM revenue_entries
        WHERE YEAR(entry_date) = YEAR(NOW()) GROUP BY stream`
    );

    return NextResponse.json({
      entries: rows.map((r) => ({
        revenueId: r.revenue_id,
        entryDate: r.entry_date,
        stream: r.stream,
        amount: Number(r.amount),
        source: r.source,
        bookingId: r.booking_id,
        notes: r.notes,
        createdAt: r.created_at
      })),
      ytdByStream: sumRows.map((r) => ({ stream: r.stream, ytd: Number(r.s) }))
    });
  } catch (err) {
    console.error('[ebw:revenue:get]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/ebw/revenue:POST', tenantId: 'ebw' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_ebw_enabled'))) return NextResponse.json({ error: 'ebw tab disabled' }, { status: 403 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const entryDate = typeof body.entryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.entryDate) ? body.entryDate : null;
  if (!entryDate) return NextResponse.json({ error: 'entryDate (YYYY-MM-DD) required' }, { status: 400 });
  const stream = typeof body.stream === 'string' && VALID_STREAMS.has(body.stream) ? body.stream : null;
  if (!stream) return NextResponse.json({ error: 'stream required (must be a valid stream key)' }, { status: 400 });
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) return NextResponse.json({ error: 'amount must be a non-negative number' }, { status: 400 });

  const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim().slice(0, 255) : null;
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 8000) : null;
  const bookingId = typeof body.bookingId === 'number' && Number.isFinite(body.bookingId) ? body.bookingId : null;

  try {
    const db = getEbwDb();
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO revenue_entries (entry_date, stream, amount, source, booking_id, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entryDate, stream, amount.toFixed(2), source, bookingId, notes]
    );
    return NextResponse.json({ revenueId: result.insertId }, { status: 201 });
  } catch (err) {
    console.error('[ebw:revenue:post]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
