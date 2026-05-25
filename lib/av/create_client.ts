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
import { setClientAccess } from '@/lib/av/client_access';
import { extractBriefSeedFromIntake } from '@/lib/client/intake_brief';
import { createLane } from '@/lib/campaigns/store';
import { sendEmail } from '@/lib/email/smtp';
import { buildMagicLinkEmail } from '@/lib/email/magic-link-template';
import { getAvDb } from '@/lib/db/av';
import type { ClientTier } from '@/lib/client-portal/tiers';
import type { ResultSetHeader } from 'mysql2';

export interface CreateClientInput {
  email: string;
  name?: string | null;
  company?: string | null;
  industry?: string | null;
  tier?: ClientTier;          // default 'scale' (full package for testers)
  trialDays?: number | null;  // grant a trial window; null/0 = no expiry
  sendInvite?: boolean;       // email the magic link (default true)
  /** Any creative-brief answers the operator entered (key_message, etc.). */
  intake?: Record<string, unknown>;
  /** Link existing leads that share this email to the new client (default true). */
  linkLeadsByEmail?: boolean;
}

export interface CreateClientResult {
  clientId: number | null;
  clientUserId: number;
  magicLink: string;
  emailSent: boolean;
  lineSeeded: boolean;
  created: boolean;
  leadsLinked: number;
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

  // Stand up their hub (clients row + client_id link).
  let clientId: number | null = row.client_id;
  if (!clientId) {
    try { clientId = await ensureClientHub(row); } catch { clientId = null; }
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

  // Link any EXISTING leads that share this email to the new client (default on),
  // so leads already imported (e.g. via CSV) carry over without retyping and their
  // audits/content scope to the client. Skips leads already owned by a client.
  let leadsLinked = 0;
  if (clientId && input.linkLeadsByEmail !== false) {
    try {
      const db = getAvDb();
      const [res] = await db.execute<ResultSetHeader>(
        `UPDATE leads SET client_id = ?, last_activity_at = NOW()
          WHERE email = ? AND client_id IS NULL AND archived_at IS NULL`,
        [clientId, email]
      );
      leadsLinked = res.affectedRows ?? 0;
    } catch { /* non-fatal: linking can be done later */ }
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

  return { clientId, clientUserId: row.client_user_id, magicLink: link, emailSent, lineSeeded, created, leadsLinked };
}
