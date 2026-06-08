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
import { getBriefPayload, saveBriefPayload } from '@/lib/client/brief_store';
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
  // (#514, val 2026-06-08) Website URL — when val needs to add or correct the
  // website on an existing client. Lands in creative_briefs.brief_payload as
  // website_url (canonical key) so every panel that reads the website via
  // resolveClientWebsite() sees it immediately.
  const websiteProvided = typeof body.websiteUrl === 'string';
  const websiteRaw = clean(body.websiteUrl, 500);
  // Normalize: tolerate "circaenergy.com" without scheme — store as https://.
  const websiteUrl = websiteRaw
    ? (/^https?:\/\//i.test(websiteRaw) ? websiteRaw : `https://${websiteRaw}`)
    : null;
  // (#537) KYC fields — land in brief_payload alongside the other identity
  // keys. Distinguish provided-empty (clear) from absent (leave alone).
  const ownerNameProvided = typeof body.ownerName === 'string';
  const ownerName = clean(body.ownerName, 255);
  const businessStateProvided = typeof body.businessState === 'string';
  const businessState = clean(body.businessState, 2);
  const businessAddressProvided = typeof body.businessAddress === 'string';
  const businessAddress = clean(body.businessAddress, 500);

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

    // (#519, val 2026-06-08) Mirror account fields into brief_payload under
    // their canonical keys. The clients.* and client_users.* writes above are
    // the operational source of truth, but every prompt / preview / dossier /
    // intake-editor surface reads brief_payload.{company,contact_name,industry,
    // website_url}. Without this mirror, val types Skip Krause + the brief
    // still shows "blank contact_name" everywhere it's consumed.
    //
    // ONE bundled write -> ONE snapshot + ONE autopilot fire. Always-overwrite-
    // when-provided semantics (mirrors the #514 website behavior): the form
    // pre-fills initial values, so an "unchanged" save just re-writes the same
    // value. clientName / contactName only write when non-blank (form omits
    // empty); industry / website_url write when the field was in the body even
    // if cleared (use '' to clear the brief value).
    let briefSaved = false;
    let websiteSaved = false;
    const briefUpdates: Record<string, unknown> = {};
    if (clientName) briefUpdates.company = clientName;
    if (contactName) briefUpdates.contact_name = contactName;
    if (industryProvided) briefUpdates.industry = industry ?? '';
    if (websiteProvided) briefUpdates.website_url = websiteUrl ?? '';
    // (#537) KYC fields → land in the SAME brief_payload the intake form
    // writes to. owner_name = KYC target, business_state = state hint for
    // CourtListener, business_address = primary address for the address screen.
    if (ownerNameProvided) briefUpdates.owner_name = ownerName ?? '';
    if (businessStateProvided) briefUpdates.business_state = businessState ?? '';
    if (businessAddressProvided) briefUpdates.business_address = businessAddress ?? '';
    if (Object.keys(briefUpdates).length > 0) {
      try {
        const cur = ((await getBriefPayload('av', clientId)) as Record<string, unknown> | null) ?? {};
        const merged: Record<string, unknown> = { ...cur, ...briefUpdates };
        const ok = await saveBriefPayload('av', clientId, merged, {
          changedBy: guard.actor.userId ? `user:${guard.actor.userId}` : 'operator',
          source: 'account_editor'
        });
        briefSaved = ok;
        websiteSaved = ok && websiteProvided;
      } catch (err) {
        console.error('[account:briefSave]', clientId, (err as Error).message);
      }
    }

    return NextResponse.json({
      ok: true,
      clientName,
      industry: industryProvided ? industry : undefined,
      shortName: shortNameProvided ? shortName : undefined,
      contactName,
      emailUpdated,
      contactEmail: newMemberEmail ?? memberEmail,
      websiteSaved,
      websiteUrl: websiteProvided ? websiteUrl : undefined
    });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
