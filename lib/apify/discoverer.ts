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
  type InstagramProfile
} from '@/lib/apify/instagram';
import { inferTargetBusinessFromRaw, type TargetBusiness } from '@/lib/leads/target_business';
import { findExistingLead, normalizeDomain, mergeTargetBusiness } from '@/lib/leads/dedup';
import { scrapeContactPage } from '@/lib/scraper/contact_page';
import { logEvent } from '@/lib/events/log';
import { scoreAndAuditLeadBackground } from '@/lib/ai/score_and_audit';
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
