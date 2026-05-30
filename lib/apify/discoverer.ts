/**
 * lib/apify/discoverer.ts
 *
 * Run Apify Instagram Profile Scraper for a list of handles, then insert
 * each profile as a lead with:
 *   - company = fullName or username
 *   - website = bio link / externalUrl / parsed-from-bio URL
 *   - email = business_email OR parsed-from-bio email OR placeholder
 *   - phone = business_phone OR parsed-from-bio phone
 *   - industry = from businessCategoryName via instagramCategoryToIndustry
 *
 * Dedup on a synthetic apollo_person_id like 'ig:foo' so we don't double-insert
 * the same IG handle across runs. Also runs the cross-source domain dedup.
 */

import { randomUUID } from 'crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getAvDb } from '@/lib/db/av';
import {
  apifyInstagramProfiles,
  extractContactFromBio,
  instagramCategoryToIndustry,
  normalizeInstagramHandle,
  ApifyTokenMissingError,
  type InstagramProfile
} from '@/lib/apify/instagram';
import { inferTargetBusinessFromRaw, type TargetBusiness } from '@/lib/leads/target_business';
import { findExistingLead, normalizeDomain, mergeTargetBusiness } from '@/lib/leads/dedup';
import { scrapeContactPage } from '@/lib/scraper/contact_page';
import { logEvent } from '@/lib/events/log';
import { scoreAndAuditLeadBackground } from '@/lib/ai/score_and_audit';
import { autoThreadLeadByFitBackground } from '@/lib/campaigns/lines_for_lead';
import { enrichLeadFromSource } from '@/lib/enrichment/multi_source_enricher';
import type { InstagramProfile as IgProfile } from '@/lib/apify/instagram';

export type InstagramDiscoverOutcome =
  | 'inserted'
  | 'duplicate_existing'
  | 'duplicate_target_upgraded'
  /** (#251 Inc 1b) Existing lead got fresh IG signal written onto its row +
   *  source_payload (followers, bio, business category, external URL, etc.)
   *  instead of those fields being discarded on the dedup match. */
  | 'duplicate_enriched'
  | 'profile_not_found'
  | 'insufficient_contact'
  | 'insert_failed';

/**
 * (#251 Inc 1b) Build the multi-source enrichment patch shape from an
 * Instagram profile. Mirrors buildPlacesPatch — fields the leads table has
 * columns for go in `fields`, IG-specific signal that has no column goes in
 * `sourceMetadata` so it lives on source_payload for later use (e.g. the
 * lead detail page's "where this data came from" provenance hover).
 */
function buildInstagramPatch(
  prof: IgProfile,
  email: string | null,
  phone: string | null,
  website: string | null,
  industry: string | null,
  bioContact: { email: string | null; phone: string | null; bookingUrl: string | null }
) {
  return {
    fields: {
      phone: phone ?? undefined,
      website: website ?? undefined,
      industry: industry ?? undefined
      // No email/contact_name — Hunter wins the email contest, and IG
      // profiles don't reliably carry a real-person contact name.
    },
    sourceMetadata: {
      ig_username: prof.username,
      ig_profile_url: prof.profileUrl,
      ig_full_name: prof.fullName,
      ig_biography: prof.biography,
      ig_external_url: prof.externalUrl,
      ig_business_category: prof.businessCategoryName,
      ig_followers: prof.followersCount,
      ig_follows: prof.followsCount,
      ig_posts: prof.postsCount,
      ig_is_business: prof.isBusinessAccount,
      ig_is_verified: prof.isVerified,
      // Bio-parsed contact bits are preserved as the original would have on
      // an insert — so anyone reading source_payload can audit what came
      // from where, even when only metadata (not column fills) was merged.
      parsed_from_bio: { email: bioContact.email, phone: bioContact.phone, url: bioContact.bookingUrl },
      // The email/business email Apify directly returned (separate from bio
      // parse). NOT written to leads.email by this path — captured as
      // provenance only so future "find another POC" / outreach flows can
      // read it without re-hitting Apify.
      ig_business_email: prof.businessEmail ?? null,
      ig_business_phone: prof.businessPhoneNumber ?? null,
      ig_email_for_provenance: email ?? null
    },
    note: 'duplicate-hit enrichment (Instagram)'
  };
}

export interface InstagramDiscoverResult {
  username: string;
  outcome: InstagramDiscoverOutcome;
  leadId?: number;
  details: {
    company: string;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
    industry?: string | null;
    isBusinessAccount?: boolean;
    followersCount?: number | null;
    error?: string;
  };
}

export interface InstagramDiscoverBatchResult {
  inputUsernames: string[];
  resolvedCount: number;
  insertedCount: number;
  duplicateCount: number;
  /** (#251 Inc 1b) Existing leads whose data this sweep filled with fresh
   *  Instagram signal (phone/website/industry + followers/bio/category metadata).
   *  Counted alongside insertedCount so the operator sees compounding intel. */
  enrichedCount: number;
  results: InstagramDiscoverResult[];
}

const IG_PREFIX = 'ig:';

async function insertOneProfile(db: Pool, prof: InstagramProfile, clientId: number | null = null): Promise<InstagramDiscoverResult> {
  const company = prof.fullName || prof.username;
  const bioContact = extractContactFromBio(prof.biography);

  // Start with whatever Apify gives us directly + what we can parse from bio text.
  let email = prof.businessEmail || bioContact.email;
  let phone = prof.businessPhoneNumber || bioContact.phone;
  const website = prof.externalUrl || bioContact.bookingUrl || null;

  // If we have a link-in-bio URL but still no real email/phone, scrape that
  // page inline. Most boutique IG businesses link to a website (linktr.ee,
  // their own site, Squarespace booking page) — this pulls the email/phone
  // out of THAT page so the lead lands fully enriched in one shot, rather
  // than waiting for the bulk-fill follow-up.
  //
  // Cost: one extra HTTP fetch per profile (~1-3s). Bounded by the scraper's
  // own 8s/page timeout + 5-page cap.
  let inlineScrapeUsed = false;
  if (website && (!email || !phone)) {
    try {
      const scraped = await scrapeContactPage(website);
      if (!email && scraped.email) email = scraped.email;
      if (!phone && scraped.phone) phone = scraped.phone;
      inlineScrapeUsed = true;
    } catch {
      // Silent fail — the lead will still insert, bulk-fill can retry later.
    }
  }

  if (!email) email = `noemail+ig-${prof.username}@eventsbywater.com`;
  const domain = normalizeDomain(website);
  const industry = instagramCategoryToIndustry(prof.businessCategoryName);
  const targetBusiness: TargetBusiness = inferTargetBusinessFromRaw(prof.businessCategoryName);
  const dedupKey = clientId && clientId > 0 ? `c${clientId}:${IG_PREFIX}${prof.username}` : `${IG_PREFIX}${prof.username}`;
  const auditId = randomUUID();

  // Dedup by IG handle first (re-running the same search shouldn't dupe)
  const [byHandle] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE apollo_person_id = ? LIMIT 1`,
    [dedupKey]
  );
  if (byHandle.length > 0) {
    // (#251 Inc 1b) The IG handle already mapped to a lead. That doesn't
    // mean the IG profile changed — but if it did (new bio, new follower
    // count, new business category), we want to compound that onto the lead.
    // blanks-only on columns; source_payload always gets the fresh metadata.
    const enrichment = await enrichLeadFromSource({
      leadId: byHandle[0].id,
      source: 'instagram_apify',
      patch: buildInstagramPatch(prof, email, phone, website, industry, bioContact)
    });
    return {
      username: prof.username,
      outcome: enrichment.filled > 0 || enrichment.metadataMerged ? 'duplicate_enriched' : 'duplicate_existing',
      leadId: byHandle[0].id,
      details: { company, email, phone, website, industry, isBusinessAccount: prof.isBusinessAccount, followersCount: prof.followersCount }
    };
  }

  // Then by cross-source dedup (domain match against existing lead from Apollo/Places/etc.)
  const existing = await findExistingLead(db, { domain: website, phone, mode: 'loose' });
  if (existing) {
    // (#251 Inc 1b) Same enrichment write as the IG-handle branch — fill any
    // blanks on the existing cross-source lead from this IG profile, and
    // always merge IG-specific signal (followers, bio, category, external
    // URL, verification) onto source_payload. Compound across sources.
    const enrichment = await enrichLeadFromSource({
      leadId: existing.leadId,
      source: 'instagram_apify',
      patch: buildInstagramPatch(prof, email, phone, website, industry, bioContact)
    });
    const merged = mergeTargetBusiness(existing.targetBusiness ?? 'av', targetBusiness);
    if (merged !== existing.targetBusiness) {
      await db.execute(`UPDATE leads SET target_business = ?, last_activity_at = NOW() WHERE id = ?`, [
        merged,
        existing.leadId
      ]);
      return {
        username: prof.username,
        outcome: 'duplicate_target_upgraded',
        leadId: existing.leadId,
        details: { company, email, phone, website, industry, isBusinessAccount: prof.isBusinessAccount, followersCount: prof.followersCount }
      };
    }
    return {
      username: prof.username,
      outcome: enrichment.filled > 0 || enrichment.metadataMerged ? 'duplicate_enriched' : 'duplicate_existing',
      leadId: existing.leadId,
      details: { company, email, phone, website, industry, isBusinessAccount: prof.isBusinessAccount, followersCount: prof.followersCount }
    };
  }

  // Need AT LEAST a real email, phone, or website to make this useful.
  const hasRealEmail = prof.businessEmail || bioContact.email;
  if (!hasRealEmail && !phone && !website) {
    return {
      username: prof.username,
      outcome: 'insufficient_contact',
      details: { company, industry, isBusinessAccount: prof.isBusinessAccount, followersCount: prof.followersCount }
    };
  }

  const sourcePayload = {
    source: 'apify/instagram-profile-scraper',
    ig_username: prof.username,
    ig_profile_url: prof.profileUrl,
    ig_full_name: prof.fullName,
    ig_biography: prof.biography,
    ig_external_url: prof.externalUrl,
    ig_business_category: prof.businessCategoryName,
    ig_followers: prof.followersCount,
    ig_follows: prof.followsCount,
    ig_posts: prof.postsCount,
    ig_is_business: prof.isBusinessAccount,
    ig_is_verified: prof.isVerified,
    parsed_from_bio: { email: bioContact.email, phone: bioContact.phone, url: bioContact.bookingUrl },
    inline_link_scrape_used: inlineScrapeUsed
  };

  try {
    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO leads (
         audit_id, company, email, phone, website, normalized_domain,
         industry, lead_status, source_type, target_business, source_payload,
         apollo_person_id, client_id, last_activity_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 'scrape', ?, ?, ?, ?, NOW())`,
      [
        auditId,
        company,
        email,
        phone,
        website,
        domain,
        industry,
        targetBusiness,
        JSON.stringify(sourcePayload),
        dedupKey,
        clientId
      ]
    );
    const newLeadId = result.insertId;
    await logEvent({
      eventType: 'lead.created',
      leadId: newLeadId,
      source: 'instagram',
      status: 'success',
      payload: {
        company,
        ig_username: prof.username,
        is_business: prof.isBusinessAccount,
        followers: prof.followersCount,
        industry,
        target_business: targetBusiness,
        inline_link_scrape_used: inlineScrapeUsed
      }
    });
    scoreAndAuditLeadBackground(newLeadId);
    // (#46 spine Inc 2) Auto-thread to the best-fit narrative line.
    autoThreadLeadByFitBackground(newLeadId);
    return {
      username: prof.username,
      outcome: 'inserted',
      leadId: newLeadId,
      details: { company, email, phone, website, industry, isBusinessAccount: prof.isBusinessAccount, followersCount: prof.followersCount }
    };
  } catch (err) {
    await logEvent({
      eventType: 'workflow.failed',
      source: 'instagram',
      status: 'failure',
      payload: { stage: 'insertOneProfile', company, ig_username: prof.username },
      errorMessage: (err as Error).message.slice(0, 500)
    });
    return {
      username: prof.username,
      outcome: 'insert_failed',
      details: { company, error: (err as Error).message }
    };
  }
}

export async function runInstagramDiscoveryBatch(usernames: string[], opts: { clientId?: number | null } = {}): Promise<InstagramDiscoverBatchResult> {
  const db = getAvDb();
  const profiles = await apifyInstagramProfiles(usernames);
  const seen = new Set<string>(profiles.map((p) => p.username));
  const results: InstagramDiscoverResult[] = [];
  for (const prof of profiles) {
    results.push(await insertOneProfile(db, prof, opts.clientId ?? null));
  }
  // Any input usernames not in profiles array → profile_not_found.
  for (const raw of usernames) {
    const norm = raw.trim().toLowerCase().replace(/^@/, '');
    if (norm && !seen.has(norm)) {
      results.push({
        username: norm,
        outcome: 'profile_not_found',
        details: { company: norm }
      });
    }
  }
  const insertedCount = results.filter((r) => r.outcome === 'inserted').length;
  const enrichedCount = results.filter((r) => r.outcome === 'duplicate_enriched').length;
  // (#251 Inc 1b) duplicateCount includes pure duplicates AND target_upgrades
  // AND enriched duplicates — keeps the existing UI count stable. enrichedCount
  // is broken out separately as the new "compounding intel" signal.
  const duplicateCount = results.filter((r) =>
    r.outcome === 'duplicate_existing' ||
    r.outcome === 'duplicate_target_upgraded' ||
    r.outcome === 'duplicate_enriched'
  ).length;
  return {
    inputUsernames: usernames,
    resolvedCount: profiles.length,
    insertedCount,
    duplicateCount,
    enrichedCount,
    results
  };
}

/* ===========================================================================
 * (#269) Per-lead Instagram enrichment.
 *
 * Given a single existing lead, find their IG handle (from prior smart-scrape
 * captures in source_payload OR a normalized-company-name guess), fetch the
 * profile via Apify, run enrichLeadFromSource with the existing
 * buildInstagramPatch. Blanks-only — never overwrites curated data.
 *
 * Handle resolution priority:
 *   1. Explicit handle passed in args.handleOverride (operator-supplied)
 *   2. source_payload.scraped_socials.instagram or source_payload.socials.instagram
 *      (whatever the contact-page scraper or smart-LLM scraper captured)
 *   3. source_payload.ig_username (already enriched once before)
 *   4. Fallback: normalized company name (e.g. "NDVIP Solutions" → "ndvipsolutions")
 *
 * The fallback is best-effort — IG handles often don't match company names
 * exactly, so we surface "no profile found" honestly when Apify returns blanks.
 * Never throws — soft failures return {ok: false, reason}.
 * =========================================================================== */
export interface EnrichLeadFromInstagramResult {
  ok: boolean;
  /** How many lead columns were filled (excludes source_payload metadata). */
  filled?: number;
  fields?: string[];
  /** The IG handle we landed on (so val can verify the right account). */
  matchedHandle?: string;
  matchedProfile?: {
    username: string;
    fullName: string | null;
    profileUrl: string | null;
    biography: string | null;
    businessCategory: string | null;
    followersCount: number | null;
    isVerified: boolean | null;
  };
  /** Where the handle came from — gives val confidence in the match. */
  handleSource?: 'override' | 'scraped' | 'previous_enrich' | 'company_name_fallback';
  reason?: string;
}

interface PerLeadIgEnrichRow extends RowDataPacket {
  id: number;
  company: string | null;
  website: string | null;
  source_payload: string | object | null;
}

function asObj(raw: string | object | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Pull an IG handle out of whatever shape source_payload captured it as.
 *  Different scrapers / discovery paths store under slightly different keys;
 *  this consolidates them. Returns null if nothing usable found. */
function extractStoredIgHandle(sp: Record<string, unknown>): string | null {
  // Direct fields stamped by previous IG enrichments
  const ig1 = typeof sp.ig_username === 'string' ? sp.ig_username : null;
  if (ig1) {
    const n = normalizeInstagramHandle(ig1);
    if (n) return n;
  }
  // Smart-scraper / contact-page scraper formats
  const candidates: unknown[] = [];
  const scraped = sp.scraped_socials;
  if (scraped && typeof scraped === 'object') {
    const obj = scraped as Record<string, unknown>;
    candidates.push(obj.instagram);
  }
  const socials = sp.socials;
  if (socials && typeof socials === 'object') {
    const obj = socials as Record<string, unknown>;
    candidates.push(obj.instagram);
  }
  // Smart LLM scraper sometimes stamps a flat key
  if (typeof sp.instagram_url === 'string') candidates.push(sp.instagram_url);
  if (typeof sp.instagram === 'string') candidates.push(sp.instagram);

  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const n = normalizeInstagramHandle(c);
    if (n) return n;
  }
  return null;
}

/** Cheap company-name → handle guess. "NDVIP Solutions, LLC" → "ndvipsolutions".
 *  Strips legal suffixes + punctuation + lowercases. Returns null when the
 *  result is too short (< 3 chars) to be a plausible handle. */
function guessHandleFromCompany(company: string): string | null {
  const cleaned = company
    .toLowerCase()
    .replace(/\b(llc|inc|ltd|co|corp|company|llp|gmbh|sa|sas|pte|plc|holdings?)\b/g, '')
    .replace(/[^a-z0-9._]/g, '')
    .slice(0, 30);
  return cleaned.length >= 3 ? cleaned : null;
}

export async function enrichLeadFromInstagram(args: {
  leadId: number;
  handleOverride?: string | null;
  actorUserId?: number | null;
}): Promise<EnrichLeadFromInstagramResult> {
  if (!Number.isInteger(args.leadId) || args.leadId <= 0) {
    return { ok: false, reason: 'invalid lead id' };
  }
  const db = getAvDb();
  const [rows] = await db.execute<PerLeadIgEnrichRow[]>(
    `SELECT id, company, website, source_payload FROM leads WHERE id = ? AND archived_at IS NULL LIMIT 1`,
    [args.leadId]
  );
  const lead = rows[0];
  if (!lead) return { ok: false, reason: 'lead not found or archived' };

  // Resolve which handle to use, in priority order.
  let handle: string | null = null;
  let handleSource: EnrichLeadFromInstagramResult['handleSource'];
  if (args.handleOverride && args.handleOverride.trim()) {
    handle = normalizeInstagramHandle(args.handleOverride.trim());
    handleSource = 'override';
  }
  if (!handle) {
    const sp = asObj(lead.source_payload);
    const stored = extractStoredIgHandle(sp);
    if (stored) {
      handle = stored;
      // Distinguish a handle already stamped by a previous IG enrich from one
      // freshly captured by the website scraper, since val should trust them
      // differently in the UI.
      handleSource = typeof sp.ig_username === 'string' ? 'previous_enrich' : 'scraped';
    }
  }

  // (#270) Auto-trigger a contact-page scrape if we still don't have a
  // handle and the lead has a website. "manual googling × 100 clients" is
  // not the answer — we have a working scraper already, just call it. This
  // costs no API credits (regex-over-HTML), so it's free to try.
  if (!handle && (lead.website ?? '').trim()) {
    try {
      const scraped = await scrapeContactPage(lead.website!.trim());
      const igUrl = scraped.socials?.instagram ?? null;
      if (igUrl) {
        const norm = normalizeInstagramHandle(igUrl);
        if (norm) {
          handle = norm;
          handleSource = 'scraped';
          // Persist the scraped handle to source_payload so the next call
          // skips the scrape entirely. Non-fatal if it fails.
          await db.execute(
            `UPDATE leads SET source_payload = JSON_MERGE_PATCH(
                COALESCE(source_payload, JSON_OBJECT()),
                CAST(? AS JSON)
              )
              WHERE id = ?`,
            [JSON.stringify({ scraped_socials: scraped.socials ?? {} }), lead.id]
          ).catch(() => { /* non-fatal */ });
        }
      }
    } catch {
      // scraper failures fall through to the company-name guess
    }
  }

  if (!handle && lead.company && lead.company.trim()) {
    handle = guessHandleFromCompany(lead.company);
    handleSource = 'company_name_fallback';
  }
  if (!handle) {
    return {
      ok: false,
      reason: 'No IG handle on file and the company name was too short to guess one. Either Smart-enrich the website first (we capture social links) or set a company name.'
    };
  }

  // Fetch profile from Apify. apifyInstagramProfiles always returns one entry
  // per input — a profile with all-nulls means Apify couldn't find that
  // handle (private/banned/typo). We treat that as a soft fail.
  let profiles: InstagramProfile[];
  try {
    profiles = await apifyInstagramProfiles([handle]);
  } catch (err) {
    await logEvent({
      eventType: 'instagram.lead_enrich_failed',
      leadId: lead.id,
      userId: args.actorUserId ?? null,
      source: 'instagram',
      status: 'failure',
      errorMessage: (err as Error).message.slice(0, 400),
      payload: { stage: 'apify_fetch', handle, handle_source: handleSource }
    });
    if (err instanceof ApifyTokenMissingError) {
      return { ok: false, reason: 'Apify token not configured — set APIFY_TOKEN in Netlify env.' };
    }
    return { ok: false, reason: `Instagram fetch failed: ${(err as Error).message.slice(0, 240)}` };
  }

  const prof = profiles[0];
  // "Apify returned nothing useful" check — fullName + biography + followers
  // all null is the signal Apify couldn't actually load the profile.
  const usable = prof && (prof.fullName || prof.biography || prof.followersCount != null || prof.externalUrl);
  if (!prof || !usable) {
    const hint = handleSource === 'company_name_fallback'
      ? ` (we guessed "@${handle}" from the company name — try Smart-enriching the website first so we can capture the real handle, or paste it in directly)`
      : '';
    return {
      ok: false,
      matchedHandle: handle,
      handleSource,
      reason: `Instagram couldn't load a profile for @${handle}${hint}.`
    };
  }

  // Derive the same fields the discovery path would: bio-parsed contact,
  // chosen email (business email or bio-parsed), phone, website, industry.
  const bioContact = extractContactFromBio(prof.biography);
  const email = prof.businessEmail || bioContact.email || null;
  const phone = prof.businessPhoneNumber || bioContact.phone || null;
  const website = prof.externalUrl || bioContact.bookingUrl || null;
  const industry = instagramCategoryToIndustry(prof.businessCategoryName);
  const patch = buildInstagramPatch(prof, email, phone, website, industry, bioContact);

  const result = await enrichLeadFromSource({
    leadId: lead.id,
    source: 'instagram_apify',
    patch
  });

  await logEvent({
    eventType: 'instagram.lead_enriched',
    leadId: lead.id,
    userId: args.actorUserId ?? null,
    source: 'instagram',
    status: 'success',
    payload: {
      handle,
      handle_source: handleSource,
      filled: result.filled,
      filled_fields: result.fields
    }
  });

  return {
    ok: true,
    filled: result.filled,
    fields: result.fields,
    matchedHandle: handle,
    handleSource,
    matchedProfile: {
      username: prof.username,
      fullName: prof.fullName,
      profileUrl: prof.profileUrl,
      biography: prof.biography,
      businessCategory: prof.businessCategoryName,
      followersCount: prof.followersCount,
      isVerified: prof.isVerified
    }
  };
}
