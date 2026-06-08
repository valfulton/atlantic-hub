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
import { getBriefPayload, saveBriefPayload } from '@/lib/client/brief_store';

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

/**
 * Normalize a URL the operator/LLM pasted: trim, add https:// if missing,
 * strip whitespace. Returns null if the input doesn't look like a URL after
 * normalization. Mirrors the normalization in
 * app/api/admin/av/clients/[client_id]/account/route.ts so all entry points
 * write the same value.
 */
export function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  // Quick sanity: must parse as a URL with a hostname containing a dot.
  try {
    const u = new URL(s);
    if (!u.hostname || !u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * (#517) Stamp the website URL into brief_payload.website_url IF the brief
 * doesn't already have a website on any of the historical keys.
 *
 * Why this exists (val 2026-06-08): the fill-intake-from-web, brand-kit, and
 * social-scrape endpoints all take a URL, fetch it, and run their work — but
 * none of them write the URL back to the brief. So a client could have a
 * successful audit (homepage_url on the snapshot), brand-kit colors, and
 * intake fill — and the pre-flight check still says "no website on brief"
 * because nobody persisted the URL into the canonical location.
 *
 * This helper makes any successful scrape an authoritative source for the
 * website: if you pasted a URL and the fetch worked, that IS the website.
 *
 * SAFETY: blanks-only. If brief_payload already has a website under ANY of
 * the historical keys, this is a no-op — we don't overwrite a hand-curated
 * value. Returns true if the brief was updated, false otherwise.
 */
export async function stampWebsiteOnBrief(
  tenantId: string,
  clientId: number | null | undefined,
  rawUrl: string | null | undefined,
  opts: { changedBy?: string | null; source?: string } = {}
): Promise<boolean> {
  if (!clientId) return false;
  const url = normalizeWebsiteUrl(rawUrl);
  if (!url) return false;
  try {
    const brief = ((await getBriefPayload(tenantId, clientId)) ?? {}) as Record<string, unknown>;
    // If any historical key is already set, don't overwrite. The brief wins.
    if (pickWebsiteFromBrief(brief)) return false;
    const merged = { ...brief, website_url: url };
    const ok = await saveBriefPayload(tenantId, clientId, merged, {
      changedBy: opts.changedBy ?? null,
      source: opts.source ?? 'website_resolver'
    });
    return !!ok;
  } catch {
    return false;
  }
}
