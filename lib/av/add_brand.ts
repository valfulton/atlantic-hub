/**
 * lib/av/add_brand.ts
 *
 * Multi-brand (#101): give an EXISTING owner login a SECOND (third, …) brand,
 * without minting another login. This is how Adriana ends up owning both CBB and
 * CLDA under one account: create CBB the normal way, then add CLDA here.
 *
 *   1. createBrandHub -> a new `clients` row (its own scope: brief/ICP/lines/leads)
 *   2. brand_members(owner) row linking the existing login to the new brand
 *   3. tier/access on the new brand
 *   4. optional creative brief (intake) written for the new brand
 *   5. a CANDIDATE narrative line seeded from any intake answers
 *
 * The brand stays a clean separate scope; only the PERSON + (later) the calendar
 * are unified. See Atlantic_Hub_Playbook/Architecture_MultiBrand_Accounts.md.
 */
import { createBrandHub, planTierFor, type PlanTier } from '@/lib/client/provision';
import { setBrandMember } from '@/lib/client/membership';
import { setClientAccess } from '@/lib/av/client_access';
import { saveBriefPayload } from '@/lib/client/brief_store';
import { extractBriefSeedFromIntake } from '@/lib/client/intake_brief';
import { createLane } from '@/lib/campaigns/store';
import { findClientUserById } from '@/lib/auth/client-user';
import type { ClientTier } from '@/lib/client-portal/tiers';

export interface AddBrandInput {
  /** The existing login that will OWN the new brand. */
  ownerClientUserId: number;
  /** Brand / company name (becomes the clients.client_name). */
  name: string;
  industry?: string | null;
  tier?: ClientTier;
  trialDays?: number | null;
  /** Any creative-brief answers to seed the new brand with. */
  intake?: Record<string, unknown>;
}

export interface AddBrandResult {
  clientId: number | null;
  briefSaved: boolean;
  lineSeeded: boolean;
}

export async function addBrandForOwner(input: AddBrandInput): Promise<AddBrandResult> {
  const owner = await findClientUserById(input.ownerClientUserId);
  if (!owner) throw new Error('owner login not found');

  const name = (input.name && input.name.trim()) || (input.industry && input.industry.trim()) || 'New brand';
  const planTier: PlanTier = planTierFor((input.tier ?? 'scale') as never);

  const clientId = await createBrandHub(name, planTier);
  if (!clientId) return { clientId: null, briefSaved: false, lineSeeded: false };

  // Link the existing person as OWNER of the new brand.
  await setBrandMember(input.ownerClientUserId, clientId, 'owner').catch(() => {});

  // Tier + optional trial window (default permanent full package, like create_client).
  try {
    await setClientAccess(clientId, {
      tier: input.tier ?? 'scale',
      grantDays: input.trialDays && input.trialDays > 0 ? input.trialDays : undefined,
      accessUntil: !input.trialDays ? null : undefined
    });
  } catch { /* non-fatal: access can be set from the detail page */ }

  // Brand-scoped intake/brief (a second brand has no own login, so the brief must
  // be written for this client_id rather than carried on client_users).
  const intake: Record<string, unknown> = {
    ...(input.intake ?? {}),
    company: input.intake?.company ?? name,
    industry: input.industry ?? input.intake?.industry ?? null,
    source: 'operator_added_brand'
  };
  let briefSaved = false;
  try {
    briefSaved = await saveBriefPayload('av', clientId, intake, { source: 'operator', changedBy: null });
  } catch { /* non-fatal */ }

  // Seed a candidate narrative line from whatever was entered.
  let lineSeeded = false;
  try {
    const seed = extractBriefSeedFromIntake(intake);
    if (seed.lineSeed.thesis || seed.lineSeed.audience) {
      await createLane({ tenantId: 'av', clientId, ...seed.lineSeed });
      lineSeeded = true;
    }
  } catch { /* non-fatal */ }

  return { clientId, briefSaved, lineSeeded };
}
