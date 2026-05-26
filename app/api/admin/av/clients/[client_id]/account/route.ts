/**
 * POST /api/admin/av/clients/[client_id]/account
 *
 * Operator edit of a client's ACCOUNT info (not their creative brief). Lets val
 * fix the things that otherwise required raw SQL:
 *   - clients.client_name        -> the label shown everywhere (cockpit, lists)
 *   - clients.industry           -> optional
 *   - client_users.display_name  -> the name the client sees ("Welcome back, X")
 *     for ONE member, targeted by email (the primary contact on the account).
 *
 * Why this exists: converting a lead -> client could leave the account named
 * after the email handle (e.g. "skipk79") instead of the person ("Skip Krause"),
 * and there was no in-app way to fix it. Owner + staff only.
 *
 * Body (any subset): { clientName?, industry?, contactName?, memberEmail? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/clients/account:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) return NextResponse.json({ error: 'invalid client id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const clientName = clean(body.clientName, 255);
  // industry can be intentionally cleared, so distinguish "" (clear) from absent.
  const industryProvided = typeof body.industry === 'string';
  const industry = clean(body.industry, 255);
  const contactName = clean(body.contactName, 255);
  const memberEmail = clean(body.memberEmail, 320)?.toLowerCase() ?? null;

  try {
    const db = getAvDb();

    if (clientName) {
      await db.execute<ResultSetHeader>(`UPDATE clients SET client_name = ? WHERE client_id = ?`, [clientName, clientId]);
    }
    if (industryProvided) {
      await db.execute<ResultSetHeader>(`UPDATE clients SET industry = ? WHERE client_id = ?`, [industry, clientId]);
    }
    if (contactName && memberEmail) {
      await db.execute<ResultSetHeader>(
        `UPDATE client_users SET display_name = ? WHERE client_id = ? AND email = ?`,
        [contactName, clientId, memberEmail]
      );
    }

    return NextResponse.json({ ok: true, clientName, industry: industryProvided ? industry : undefined, contactName });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
