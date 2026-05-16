import { NextRequest, NextResponse } from 'next/server';
import { getEbwDb } from '@/lib/db/ebw';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface VesselRow extends RowDataPacket {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  vessel_name: string | null;
  vessel_type: string | null;
  markets: string | null;
  submitted_at: string;
}

interface CaptainRow extends RowDataPacket {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  license_type: string | null;
  experience_bio: string | null;
  markets: string | null;
  submitted_at: string;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/ebw/partners', tenantId: 'ebw' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_ebw_enabled'))) return NextResponse.json({ error: 'ebw tab disabled' }, { status: 403 });

  try {
    const db = getEbwDb();
    const [vRows] = await db.execute<VesselRow[]>(
      `SELECT id, first_name, last_name, email, phone, vessel_name, vessel_type, markets, submitted_at
         FROM vessel_listings ORDER BY submitted_at DESC LIMIT 500`
    );
    const [cRows] = await db.execute<CaptainRow[]>(
      `SELECT id, first_name, last_name, email, phone, city, state, license_type, experience_bio, markets, submitted_at
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
        markets: r.markets,
        submittedAt: r.submitted_at
      })),
      captains: cRows.map((r) => ({
        id: r.id,
        name: [r.first_name, r.last_name].filter(Boolean).join(' '),
        email: r.email,
        phone: r.phone,
        location: [r.city, r.state].filter(Boolean).join(', '),
        licenseType: r.license_type,
        experienceBio: r.experience_bio,
        markets: r.markets,
        submittedAt: r.submitted_at
      }))
    });
  } catch (err) {
    console.error('[ebw:partners:get]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
