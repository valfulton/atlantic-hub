import { NextRequest, NextResponse } from 'next/server';
import { getEbwDb } from '@/lib/db/ebw';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface VesselRow extends RowDataPacket {
  id: number; first_name: string | null; last_name: string | null;
  email: string | null; phone: string | null;
  vessel_name: string | null; vessel_type: string | null; vessel_length: string | null;
  home_port: string | null; passenger_capacity: number | null;
  daily_rate: string | null; markets: string | null; submitted_at: string;
}

interface CaptainRow extends RowDataPacket {
  id: number; first_name: string | null; last_name: string | null;
  email: string | null; phone: string | null;
  license_type: string | null; years_experience: string | null;
  home_waters: string | null; markets: string | null; submitted_at: string;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/ebw/partners', tenantId: 'ebw' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_ebw_enabled'))) return NextResponse.json({ error: 'ebw tab disabled' }, { status: 403 });

  try {
    const db = getEbwDb();
    const [vRows] = await db.execute<VesselRow[]>(
      `SELECT id, first_name, last_name, email, phone, vessel_name, vessel_type, vessel_length,
              home_port, passenger_capacity, daily_rate, markets, submitted_at
         FROM vessel_listings ORDER BY submitted_at DESC LIMIT 500`
    );
    const [cRows] = await db.execute<CaptainRow[]>(
      `SELECT id, first_name, last_name, email, phone, license_type, years_experience,
              home_waters, markets, submitted_at
         FROM captain_applications ORDER BY submitted_at DESC LIMIT 500`
    );
    return NextResponse.json({
      vessels: vRows.map((r) => ({
        id: r.id,
        name: [r.first_name, r.last_name].filter(Boolean).join(' '),
        email: r.email,
        phone: r.phone,
        vesselName: r.vessel_name,
        vesselType: r.vessel_type,
        vesselLength: r.vessel_length,
        homePort: r.home_port,
        passengerCapacity: r.passenger_capacity,
        dailyRate: r.daily_rate,
        markets: r.markets,
        submittedAt: r.submitted_at
      })),
      captains: cRows.map((r) => ({
        id: r.id,
        name: [r.first_name, r.last_name].filter(Boolean).join(' '),
        email: r.email,
        phone: r.phone,
        licenseType: r.license_type,
        yearsExperience: r.years_experience,
        homeWaters: r.home_waters,
        markets: r.markets,
        submittedAt: r.submitted_at
      }))
    });
  } catch (err) {
    console.error('[ebw:partners:get]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
