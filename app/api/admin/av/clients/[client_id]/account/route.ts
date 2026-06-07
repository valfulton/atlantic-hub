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
 * Body (any subset): { clientName?, shortName?, industry?, contactName?, memberEmail? }
 *
 * shortName: operator-set nickname (CBB, CLDA, EBW). Empty string clears it.
 * Schema column added by schema/073_clients_short_name.sql; if the migration
 * hasn't been applied yet the UPDATE quietly fails and the rest of the save
 * still succeeds (#406).
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
  // industry + shortName can be intentionally cleared, so distinguish ""
  // (clear) from absent. shortName: 20 chars, no spaces forced — val may want
  // "C-B-B" or "CBB" or "Central." — let her decide.
  const industryProvided = typeof body.industry === 'string';
  const industry = clean(body.industry, 255);
  const shortNameProvided = typeof body.shortName === 'string';
  const shortName = clean(body.shortName, 20);
  const contactName = clean(body.contactName, 255);
  const memberEmail = clean(body.memberEmail, 320)?.toLowerCase() ?? null;
  // (val 2026-06-07) Operator can now ADD or CHANGE the contact email on the
  // account from this surface — closes the "I created Chip without an email
  // and have no way to add one" gap. If a row already exists for this client,
  // we UPDATE its email; if none exists, we INSERT one so subsequent magic
  // link / password / prefilled-intake actions have a target.
  const newMemberEmail = clean(body.newMemberEmail, 320)?.toLowerCase() ?? null;

  try {
    const db = getAvDb();

    if (clientName) {
      await db.execute<ResultSetHeader>(`UPDATE clients SET client_name = ? WHERE client_id = ?`, [clientName, clientId]);
    }
    if (industryProvided) {
      await db.execute<ResultSetHeader>(`UPDATE clients SET industry = ? WHERE client_id = ?`, [industry, clientId]);
    }
    // (#406) short_name save is best-effort: if schema 073 hasn't been applied
    // yet, the column is missing and we swallow the error instead of failing
    // the whole save. Other updates (name/industry/contact) still land.
    if (shortNameProvided) {
      try {
        await db.execute<ResultSetHeader>(`UPDATE clients SET short_name = ? WHERE client_id = ?`, [shortName, clientId]);
      } catch (err) {
        console.error('[account:shortName]', clientId, (err as Error).message);
      }
    }
    if (contactName && memberEmail) {
      await db.execute<ResultSetHeader>(
        `UPDATE client_users SET display_name = ? WHERE client_id = ? AND email = ?`,
        [contactName, clientId, memberEmail]
      );
    }

    // (val 2026-06-07) Add/change the contact email. Three cases:
    //   1. memberEmail exists AND newMemberEmail differs → UPDATE the row's email.
    //   2. memberEmail is null AND newMemberEmail provided → INSERT a row so
    //      future magic-link / send-password actions have a target.
    //   3. newMemberEmail equals memberEmail → no-op (saving without changes).
    let emailUpdated = false;
    if (newMemberEmail) {
      if (memberEmail && newMemberEmail !== memberEmail) {
        try {
          await db.execute<ResultSetHeader>(
            `UPDATE client_users SET email = ? WHERE client_id = ? AND email = ?`,
            [newMemberEmail, clientId, memberEmail]
          );
          emailUpdated = true;
        } catch (err) {
          console.error('[account:emailUpdate]', clientId, (err as Error).message);
        }
      } else if (!memberEmail) {
        try {
          // Create a baseline client_users row so onboarding actions work.
          // password_hash NULL is fine — operator will send magic link / password.
          await db.execute<ResultSetHeader>(
            `INSERT INTO client_users (client_id, email, display_name)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE display_name = COALESCE(VALUES(display_name), display_name)`,
            [clientId, newMemberEmail, contactName ?? null]
          );
          emailUpdated = true;
        } catch (err) {
          console.error('[account:emailInsert]', clientId, (err as Error).message);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      clientName,
      industry: industryProvided ? industry : undefined,
      shortName: shortNameProvided ? shortName : undefined,
      contactName,
      emailUpdated,
      contactEmail: newMemberEmail ?? memberEmail
    });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
