/**
 * GET /api/admin/av/people/lookup  (val 2026-06-12, Phase 3 Wave 3.1)
 *
 * Returns every known client_user (existing logins) so the operator can pick
 * from a dropdown instead of typing emails by hand. Powers the people picker
 * on CollaboratorsPanel — Adriana, Skip, Mike, Maile, Rebecca, etc. all show
 * up in the list.
 *
 * Each row: { email, displayName, clientId, clientName }. The client name lets
 * val see which brand each person already belongs to — useful when binding an
 * existing client like Adriana to a NEW case (Johnson) without disturbing her
 * primary client (CBB).
 *
 * Operator-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2/promise';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PersonRow extends RowDataPacket {
  email: string;
  display_name: string | null;
  client_id: number | null;
  client_name: string | null;
  short_name: string | null;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: 'people_lookup',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const search = req.nextUrl.searchParams.get('q')?.trim().toLowerCase() ?? '';

  try {
    const db = getAvDb();
    // Pull all active client_users + their primary client (if any). Filter
    // by search term if provided (matches email OR display_name OR client_name).
    const params: unknown[] = [];
    let where = `cu.archived_at IS NULL`;
    if (search) {
      where += ` AND (
        LOWER(cu.email) LIKE ?
        OR LOWER(COALESCE(cu.display_name, '')) LIKE ?
        OR LOWER(COALESCE(c.client_name, '')) LIKE ?
      )`;
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const [rows] = await db.execute<PersonRow[]>(
      `SELECT cu.email,
              cu.display_name,
              cu.client_id,
              c.client_name,
              c.short_name
         FROM client_users cu
         LEFT JOIN clients c ON c.client_id = cu.client_id
        WHERE ${where}
        ORDER BY cu.display_name IS NULL, cu.display_name ASC, cu.email ASC
        LIMIT 100`,
      params
    );

    return NextResponse.json({
      ok: true,
      people: rows.map((r) => ({
        email: r.email,
        displayName: r.display_name,
        clientId: r.client_id,
        clientName: r.client_name,
        shortName: r.short_name
      }))
    });
  } catch (err) {
    console.error('people/lookup failed', err);
    return NextResponse.json({ ok: false, error: 'lookup failed' }, { status: 500 });
  }
}
