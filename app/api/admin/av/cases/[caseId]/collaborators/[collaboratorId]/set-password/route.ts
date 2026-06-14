/**
 * POST /api/admin/av/cases/[caseId]/collaborators/[collaboratorId]/set-password
 *
 * (val 2026-06-13) Lets the operator reset a case collaborator's password
 * WITHOUT running SQL. Targets the SPECIFIC client_user_id behind this
 * collaborator row — not the brand owner like the per-client SendPassword
 * endpoint does. So Rebecca-on-Johnson, Adriana-on-Johnson, every sibling
 * we invite can have their password set from the Family + Advisors panel.
 *
 * Body: { password: string }  (8+ chars)
 * Returns: { ok: true, email, displayName }
 *
 * Operator-only. No email sent — val shares the password however she wants.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { hashPassword } from '@/lib/auth/password';
import { setClientUserPasswordHash } from '@/lib/auth/client-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CollabRow extends RowDataPacket {
  client_user_id: number;
  email: string;
  display_name: string | null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: { caseId: string; collaboratorId: string } }
) {
  const guard = await guardAdminRequest(req, {
    targetResource: `case_collaborator_set_password:${ctx.params.collaboratorId}`,
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const caseId = parseInt(ctx.params.caseId, 10);
  const collaboratorId = parseInt(ctx.params.collaboratorId, 10);
  if (!Number.isInteger(caseId) || caseId <= 0 ||
      !Number.isInteger(collaboratorId) || collaboratorId <= 0) {
    return NextResponse.json({ ok: false, error: 'bad ids' }, { status: 400 });
  }

  let body: { password?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'body must be json' }, { status: 400 }); }

  const password = typeof body.password === 'string' ? body.password.trim() : '';
  if (password.length < 8) {
    return NextResponse.json(
      { ok: false, error: 'password must be 8+ characters', minLength: 8 },
      { status: 400 }
    );
  }
  if (password.length > 200) {
    return NextResponse.json({ ok: false, error: 'password too long' }, { status: 400 });
  }

  // Resolve which client_user this collaborator row owns. Scope to caseId
  // so a stray collaboratorId can't be used to reset someone unrelated.
  const db = getAvDb();
  const [rows] = await db.execute<CollabRow[]>(
    `SELECT cu.client_user_id, cu.email, cu.display_name
       FROM family_case_collaborators fcc
       JOIN client_users cu ON cu.client_user_id = fcc.client_user_id
      WHERE fcc.collaborator_id = ? AND fcc.case_id = ?
      LIMIT 1`,
    [collaboratorId, caseId]
  );
  const row = rows[0];
  if (!row) {
    return NextResponse.json(
      { ok: false, error: 'collaborator not found on this case' },
      { status: 404 }
    );
  }

  const hash = await hashPassword(password);
  await setClientUserPasswordHash(row.client_user_id, hash);

  return NextResponse.json({
    ok: true,
    email: row.email,
    displayName: row.display_name
  });
}
