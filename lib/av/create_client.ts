/**
 * lib/av/create_client.ts
 *
 * Operator-initiated client creation. One call stands up a full client:
 *   1. client_users row + magic-link token (reuses the intake upsert)
 *   2. their own scoped hub (clients row via ensureClientHub)
 *   3. tier + optional full-package trial window (setClientAccess)
 *   4. a CANDIDATE narrative line seeded from any intake/brief answers entered
 *
 * Reuses the exact same primitives as the public intake flow, so an
 * operator-created client is indistinguishable from a self-signup one — it just
 * skips the public form and lets the operator pre-fill + provision in one shot.
 */
import { generateMagicToken, magicTokenExpiresAt, buildMagicLinkUrl, MAGIC_TOKEN_TTL_HOURS } from '@/lib/auth/client-magic-token';
import { upsertClientUserForIntake } from '@/lib/auth/client-user';
import { ensureClientHub } from '@/lib/client/provision';
import { setBrandMember } from '@/lib/client/membership';
import { setClientAccess } from '@/lib/av/client_access';
import { extractBriefSeedFromIntake } from '@/lib/client/intake_brief';
import { createLane } from '@/lib/campaigns/store';
import { sendEmail } from '@/lib/email/smtp';
import { buildMagicLinkEmail } from '@/lib/email/magic-link-template';
import { getAvDb } from '@/lib/db/av';
import { transitionLeadStatus } from '@/lib/leads/lifecycle';
import type { ClientTier } from '@/lib/client-portal/tiers';
import type { RowDataPacket } from 'mysql2';

export interface CreateClientInput {
  email: string;
  name?: string | null;
  company?: string | null;
  industry?: string | null;
  tier?: ClientTier;          // default 'scale' (full package for testers)
  trialDays?: number | null;  // grant a trial window; null/0 = no expiry
  sendInvite?: boolean;       // email the magic link (operator chooses per create)
  /** Any creative-brief answers the operator entered (key_message, etc.). */
  intake?: Record<string, unknown>;
}

export interface CreateClientResult {
  clientId: number | null;
  clientUserId: number;
  magicLink: string;
  emailSent: boolean;
  lineSeeded: boolean;
  created: boolean;
  /** How many of this person's prospect leads were marked 'converted'. */
  leadsConverted: number;
}

export async function createClientFromOperator(input: CreateClientInput): Promise<CreateClientResult> {
  const email = input.email.toLowerCase().trim();
  const displayName = (input.name && input.name.trim()) || (input.company && input.company.trim()) || null;

  // Fold the basic fields into the intake payload so the brief/audit/line bridge
  // (extractBriefSeedFromIntake) and downstream surfaces see them.
  const intakePayload: Record<string, unknown> = {
    ...(input.intake ?? {}),
    company: input.company ?? input.intake?.company ?? null,
    industry: input.industry ?? input.intake?.industry ?? null,
    source: 'operator_created'
  };

  const magicToken = generateMagicToken();
  const expiresAt = magicTokenExpiresAt();

  const { row, created } = await upsertClientUserForIntake({
    email,
    displayName,
    magicToken,
    magicTokenExpiresAt: expiresAt,
    intakePayload
  });

  // The operator's name is AUTHORITATIVE. upsertClientUserForIntake only fills a
  // blank display_name (COALESCE), so a pre-existing blank/stale row would leave
  // display_name empty -- and ensureClientHub would then name the account from the
  // email handle (e.g. "skipk79"). Force the provided name on so the account reads
  // as the real "First Last" everywhere.
  if (displayName && row.display_name !== displayName) {
    try {
      const db = getAvDb();
      await db.execute(`UPDATE client_users SET display_name = ? WHERE client_user_id = ?`, [displayName, row.client_user_id]);
      row.display_name = displayName;
    } catch {
      /* non-fatal: the account editor can fix the name */
    }
  }

  // Stand up their hub (clients row + client_id link).
  let clientId: number | null = row.client_id;
  if (!clientId) {
    try { clientId = await ensureClientHub(row); } catch { clientId = null; }
  }

  // Register this login as OWNER of its brand (multi-brand model #101). The 058
  // backfill covered pre-existing accounts; new ones get their membership here.
  if (clientId) {
    await setBrandMember(row.client_user_id, clientId, 'owner').catch(() => {});
  }

  // Tier + optional trial window. Default to the full package for testing.
  if (clientId) {
    try {
      await setClientAccess(clientId, {
        tier: input.tier ?? 'scale',
        grantDays: input.trialDays && input.trialDays > 0 ? input.trialDays : undefined,
        accessUntil: !input.trialDays ? null : undefined // no trialDays -> permanent
      });
    } catch { /* non-fatal: access can be set later from the detail page */ }
  }

  // This person is now a CLIENT, not a prospect: mark their existing lead(s)
  // (matched by email) as 'converted' so they drop out of the active pipeline
  // instead of lingering as a "new" lead. Skips already-terminal leads. We do
  // NOT set the lead's client_id (that would make them their own prospect).
  let leadsConverted = 0;
  if (clientId) {
    try {
      const db = getAvDb();
      const [leadRows] = await db.execute<(RowDataPacket & { id: number })[]>(
        `SELECT id FROM leads
          WHERE email = ? AND archived_at IS NULL
            AND lead_status NOT IN ('converted', 'lost')
          LIMIT 20`,
        [email]
      );
      for (const lr of leadRows) {
        const res = await transitionLeadStatus({ leadId: lr.id, toStatus: 'converted', actorUserId: null });
        if (res) leadsConverted++;
      }
    } catch { /* non-fatal: lead can be marked converted manually */ }
  }

  // Seed a candidate narrative line from whatever brief answers were entered.
  let lineSeeded = false;
  if (clientId) {
    try {
      const seed = extractBriefSeedFromIntake(intakePayload);
      if (seed.lineSeed.thesis || seed.lineSeed.audience) {
        await createLane({ tenantId: 'av', clientId, ...seed.lineSeed });
        lineSeeded = true;
      }
    } catch { /* non-fatal */ }
  }

  // Email the magic link (non-fatal; the link is also returned for manual send).
  const link = buildMagicLinkUrl(magicToken);
  let emailSent = false;
  if (input.sendInvite !== false) {
    try {
      const body = buildMagicLinkEmail({
        recipientName: displayName,
        magicLinkUrl: link,
        expiresInHours: MAGIC_TOKEN_TTL_HOURS,
        isFirstTime: created || !row.password_hash
      });
      const res = await sendEmail({ to: email, subject: body.subject, text: body.text, html: body.html });
      emailSent = res.sent;
    } catch { emailSent = false; }
  }

  return { clientId, clientUserId: row.client_user_id, magicLink: link, emailSent, lineSeeded, created, leadsConverted };
}
