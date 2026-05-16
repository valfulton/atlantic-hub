import { NextRequest, NextResponse } from 'next/server';
import { getEbwDb } from '@/lib/db/ebw';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface InvestorRow extends RowDataPacket {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  investment_interest: string | null;
  nda_signed: number;
  signed_date: string | null;
  submitted_at: string;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/ebw/investors', tenantId: 'ebw' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_ebw_enabled'))) return NextResponse.json({ error: 'ebw tab disabled' }, { status: 403 });

  try {
    const db = getEbwDb();
    const [rows] = await db.execute<InvestorRow[]>(
      `SELECT id, first_name, last_name, email, phone, city, state, investment_interest,
              nda_signed, signed_date, submitted_at
         FROM investor_registrations ORDER BY submitted_at DESC LIMIT 500`
    );
    return NextResponse.json({
      investors: rows.map((r) => ({
        id: r.id,
        name: [r.first_name, r.last_name].filter(Boolean).join(' '),
        email: r.email,
        phone: r.phone,
        location: [r.city, r.state].filter(Boolean).join(', '),
        investmentInterest: r.investment_interest,
        ndaSigned: r.nda_signed === 1,
        signedDate: r.signed_date,
        submittedAt: r.submitted_at
      }))
    });
  } catch (err) {
    console.error('[ebw:investors:get]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
