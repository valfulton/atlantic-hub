/**
 * lib/client/website_resolver.ts  (#514, val 2026-06-08)
 *
 * ONE function every surface uses to answer "what is this client's website?"
 *
 * Architecture (per val's question): the website URL lives in exactly one
 * place — creative_briefs.brief_payload as JSON. There is no clients.website_url
 * column. It can be written by:
 *   - NewClientForm on creation (intake.website_url)
 *   - Fill-Intake-From-Web apply (when the LLM proposes website_url)
 *   - Client intake form submission
 *   - AccountInfoEditor (#514 — adds website field for direct edit)
 *
 * It can land under several historical keys depending on which path wrote it,
 * so this resolver checks them in priority order:
 *
 *   1. website_url   (canonical per lib/client/intake_fields.ts INTAKE_KEYS)
 *   2. websiteUrl    (legacy camelCase from earlier intake form)
 *   3. website       (lead-side key, used when promoting a lead → client)
 *   4. companyWebsite (very old key, may exist on grandfathered briefs)
 *
 * Every panel that needs the URL (FillIntakeFromWebPanel, BrandKitPanel,
 * SocialChannelsPanel, prep_preflight, prep-all, autopilot) imports from
 * here. No more drift. Update this list ONLY if a new key emerges from
 * data inspection.
 */
import { getBriefPayload } from '@/lib/client/brief_store';

/** Keys checked in priority order. Canonical (website_url) first. */
const WEBSITE_KEYS = ['website_url', 'websiteUrl', 'website', 'companyWebsite'] as const;

/**
 * Pure version: takes an already-loaded brief payload and returns the URL.
 * Use this when you already have the brief in hand (e.g. inside a route
 * that fetched it for other reasons). No DB call.
 */
export function pickWebsiteFromBrief(
  brief: Record<string, unknown> | null | undefined
): string | null {
  if (!brief || typeof brief !== 'object') return null;
  for (const k of WEBSITE_KEYS) {
    const v = (brief as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Server-side convenience: loads the brief for a client and returns the URL.
 * Returns null on any error (missing brief, DB error). Never throws — every
 * caller treats "no website" as a recoverable state.
 */
export async function resolveClientWebsite(
  tenantId: string,
  clientId: number | null | undefined
): Promise<string | null> {
  if (!clientId) return null;
  try {
    const brief = (await getBriefPayload(tenantId, clientId)) as Record<string, unknown> | null;
    return pickWebsiteFromBrief(brief);
  } catch {
    return null;
  }
}
