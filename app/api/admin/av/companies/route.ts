/**
 * GET /api/admin/av/companies
 *
 * Lightweight list of active companies (leads) for contact-association pickers.
 * Returns { id, company } newest-active first. Optional ?q= filters by company
 * name. Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface CompanyRow extends RowDataPacket {
  id: number;
  company: string | null;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/companies:GET', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';

  try {
    const db = getAvDb();
    const where: string[] = ['archived_at IS NULL', "company IS NOT NULL", "company <> ''"];
    const vals: unknown[] = [];
    if (q) {
      where.push('company LIKE ?');
      vals.push(`%${q}%`);
    }
    const [rows] = await db.execute<CompanyRow[]>(
      `SELECT id, company
         FROM leads
        WHERE ${where.join(' AND ')}
        ORDER BY company ASC
        LIMIT 500`,
      vals
    );
    return NextResponse.json({ ok: true, items: rows.map((r) => ({ id: r.id, company: r.company })) });
  } catch (err) {
    console.error('[av:companies:list]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
