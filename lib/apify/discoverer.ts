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

export type InstagramDiscoverOutcome =
  | 'inserted'
  | 'duplicate_existing'
  | 'duplicate_target_upgraded'
  | 'profile_not_found'
  | 'insufficient_contact'
  | 'insert_failed';

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
  results: InstagramDiscoverResult[];
}

const IG_PREFIX = 'ig:';

async function insertOneProfile(db: Pool, prof: InstagramProfile): Promise<InstagramDiscoverResult> {
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
  const dedupKey = `${IG_PREFIX}${prof.username}`;
  const auditId = randomUUID();

  // Dedup by IG handle first (re-running the same search shouldn't dupe)
  const [byHandle] = await db.execute<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM leads WHERE apollo_person_id = ? LIMIT 1`,
    [dedupKey]
  );
  if (byHandle.length > 0) {
    return {
      username: prof.username,
      outcome: 'duplicate_existing',
      leadId: byHandle[0].id,
      details: { company, email, phone, website, industry, isBusinessAccount: prof.isBusinessAccount, followersCount: prof.followersCount }
    };
  }

  // Then by cross-source dedup (domain match against existing lead from Apollo/Places/etc.)
  const existing = await findExistingLead(db, { domain: website, phone, mode: 'loose' });
  if (existing) {
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
      outcome: 'duplicate_existing',
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
         apollo_person_id, last_activity_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 'scrape', ?, ?, ?, NOW())`,
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
        dedupKey
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

export async function runInstagramDiscoveryBatch(usernames: string[]): Promise<InstagramDiscoverBatchResult> {
  const db = getAvDb();
  const profiles = await apifyInstagramProfiles(usernames);
  const seen = new Set<string>(profiles.map((p) => p.username));
  const results: InstagramDiscoverResult[] = [];
  for (const prof of profiles) {
    results.push(await insertOneProfile(db, prof));
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
  const duplicateCount = results.filter((r) => r.outcome === 'duplicate_existing' || r.outcome === 'duplicate_target_upgraded').length;
  return {
    inputUsernames: usernames,
    resolvedCount: profiles.length,
    insertedCount,
    duplicateCount,
    results
  };
}
